/**
 * 가동 감시기.
 *
 * **앱 코드를 하나도 부르지 않는다.** 이 호스트에서 가장 겪기 쉬운 장애가
 * 「환경변수 가드에 걸려 프로세스는 `online` 인데 모든 요청이 500」 이라서다.
 * 감시기가 앱의 `env()` 를 지나면 같은 이유로 같이 죽어 아무도 모르게 된다.
 * 텔레그램 발송도 봇 API 를 직접 두드린다 — 알림 경로가 감시 대상에 기대면 안 된다.
 *
 * 두 곳을 따로 찌른다.
 *   local  — 127.0.0.1:PORT   앱 자체가 살아 있는가
 *   public — APP_ORIGIN       회원이 실제로 닿는 길(Cloudflare Tunnel)이 살아 있는가
 * 갈라 놓아야 「앱이 죽었다」와 「터널이 죽었다」에 다른 대응을 할 수 있다.
 *
 *   pnpm health:check   한 번 확인하고 끝낸다 (알림 없음, 실패 시 exit 1)
 *   pnpm health:watch   계속 감시한다 (PM2 `bolsaram-health` 가 이 모드로 띄운다)
 *   pnpm health:test    알림 경로만 확인한다 (테스트 메시지 한 통)
 *
 * 알림은 `OPS_TELEGRAM_CHAT_ID` 로만 간다. 주선자 알림(`server/notify/`)과 섞지 않는다 —
 * 받는 사람도 다르고, 그쪽은 DB 아웃박스를 거치므로 DB 가 죽으면 함께 멈춘다.
 */
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { loadDotEnv } from "../packages/db/src/cli/dotenv";

// 해외 API 는 TCP 연결이 250ms(Node 기본값)를 넘어 완료 직전에 취소된다.
// 앱은 startup-node.ts 에서 같은 값을 올린다.
setDefaultAutoSelectFamilyAttemptTimeout(2_000);

loadDotEnv();

/** 확인 주기. 장애를 몇 분 안에 알면 충분하고, 더 잦게 찔러 얻을 것이 없다. */
const PROBE_INTERVAL_MS = 60_000;
/** 한 번 찌를 때 기다리는 시간. 이걸 넘기면 실패로 본다. */
const PROBE_TIMEOUT_MS = 10_000;
/** 몇 번 연속 실패해야 알리는가. 배포 중 재시작 한 번에 알림이 오지 않게 2회로 둔다. */
const FAILURES_BEFORE_ALERT = 2;
/** 계속 죽어 있을 때 다시 알리는 간격. 매 주기 알리면 알림이 무의미해진다. */
const REALERT_INTERVAL_MS = 30 * 60_000;

type Probe = { name: string; label: string; url: string };
type Result = Probe & { ok: boolean; detail: string };

function buildProbes(): Probe[] {
  const port = process.env.PORT ?? "3020";
  const local = `http://127.0.0.1:${port}`;
  const list: Probe[] = [{ name: "local", label: `앱 ${local}`, url: `${local}/api/health` }];

  // APP_ORIGIN 이 없거나 형태가 틀렸으면 공개 경로 확인을 건너뛴다. 감시기가 설정
  // 실수로 죽으면 정작 감시해야 할 장애를 놓친다 — 할 수 있는 것만 하고 계속 돈다.
  const origin = process.env.APP_ORIGIN;
  if (!origin) return list;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    console.warn(`APP_ORIGIN 을 읽지 못했습니다 — 공개 경로는 확인하지 않습니다: ${origin}`);
    return list;
  }
  // 로컬 개발처럼 둘이 같은 주소면 한 번만 찌른다.
  if (parsed.origin !== local) {
    list.push({ name: "public", label: `공개 ${parsed.origin}`, url: `${parsed.origin}/api/health` });
  }
  return list;
}

/** 주소는 기동 시 한 번만 정한다. 바뀌었다면 감시기를 재시작해야 한다. */
const PROBES = buildProbes();

async function probe(target: Probe): Promise<Result> {
  let response: Response;
  try {
    response = await fetch(target.url, {
      headers: { "cache-control": "no-cache" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (error) {
    // 원인 문자열에 URL 이 섞이지 않도록 이름만 싣는다.
    const reason = error instanceof Error ? error.name : "알 수 없는 오류";
    return { ...target, ok: false, detail: reason === "TimeoutError" ? "응답 없음" : "연결 실패" };
  }

  if (response.ok) return { ...target, ok: true, detail: "정상" };

  // 503 은 헬스 라우트가 스스로 내리는 값이라 본문에 원인이 있다.
  if (response.status === 503) {
    const body = (await response.json().catch(() => null)) as { db?: string } | null;
    if (body?.db === "fail") return { ...target, ok: false, detail: "DB 응답 없음" };
  }
  // 500 은 대개 환경변수 가드다 — 프로세스는 살아 있고 모든 요청이 이렇게 된다.
  const hint = response.status === 500 ? " (설정 오류일 수 있음)" : "";
  return { ...target, ok: false, detail: `HTTP ${response.status}${hint}` };
}

let missingConfigWarned = false;

async function notify(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.OPS_TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    if (!missingConfigWarned) {
      missingConfigWarned = true;
      console.warn(
        "알림을 보낼 곳이 없습니다 — .env 에 OPS_TELEGRAM_CHAT_ID 와 TELEGRAM_BOT_TOKEN 이 필요합니다.",
      );
      console.warn("감시는 계속하고 결과는 var/log/bolsaram-health.*.log 에 남습니다.");
    }
    return;
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // 토큰이 URL 에 있으므로 실패해도 URL 이나 원본 오류를 그대로 싣지 않는다.
    if (!response.ok) console.error(`알림 전송 실패 (HTTP ${response.status})`);
  } catch (error) {
    console.error(`알림 전송 실패: ${error instanceof Error ? error.name : "알 수 없는 오류"}`);
  }
}

function line(result: Result): string {
  return `${result.ok ? "○" : "✗"} ${result.label} — ${result.detail}`;
}

function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}분`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

/** 실패한 대상의 조합. 달라지면(터널만 → 앱까지) 재알림 간격을 기다리지 않고 알린다. */
function failureKey(results: Result[]): string {
  return results
    .filter((r) => !r.ok)
    .map((r) => `${r.name}:${r.detail}`)
    .join("|");
}

type State = {
  consecutiveFailures: number;
  downSince: number | null;
  alertedKey: string | null;
  lastAlertAt: number;
};

const state: State = {
  consecutiveFailures: 0,
  downSince: null,
  alertedKey: null,
  lastAlertAt: 0,
};

async function cycle(options: { verbose?: boolean } = {}): Promise<boolean> {
  const results = await Promise.all(PROBES.map(probe));
  const healthy = results.every((r) => r.ok);
  const now = Date.now();
  const stamp = new Date(now).toISOString();

  // 사람이 직접 부른 확인은 결과가 보여야 한다. 감시 모드에서는 실패했을 때만 남긴다 —
  // 1분마다 정상 줄을 쌓으면 로그에서 정작 실패한 순간을 찾을 수 없다.
  if (options.verbose) for (const result of results) console.info(line(result));

  if (healthy) {
    if (state.alertedKey !== null) {
      const downFor = state.downSince ? duration(now - state.downSince) : "알 수 없음";
      await notify(`볼사람 복구됨\n\n${results.map(line).join("\n")}\n\n중단 ${downFor}`);
    }
    if (state.consecutiveFailures > 0) console.info(`${stamp} 정상 회복`);
    state.consecutiveFailures = 0;
    state.downSince = null;
    state.alertedKey = null;
    state.lastAlertAt = 0;
    return true;
  }

  state.consecutiveFailures += 1;
  state.downSince ??= now;
  console.error(`${stamp} 실패 ${state.consecutiveFailures}회\n${results.map(line).join("\n")}`);

  if (state.consecutiveFailures < FAILURES_BEFORE_ALERT) return false;

  const key = failureKey(results);
  const changed = key !== state.alertedKey;
  if (!changed && now - state.lastAlertAt < REALERT_INTERVAL_MS) return false;

  const elapsed = duration(now - state.downSince);
  await notify(
    `볼사람 응답 없음\n\n${results.map(line).join("\n")}\n\n${elapsed}째 이어지고 있습니다.`,
  );
  state.alertedKey = key;
  state.lastAlertAt = now;
  return false;
}

// 알림 경로는 장애가 나기 전에 확인해 둬야 한다. 실제로 죽었을 때 처음 써 보는
// 알림은 안 오는 경우가 더 많다.
if (process.argv.includes("--test-alert")) {
  await notify("볼사람 가동 감시 — 알림 경로 확인용 메시지입니다. 장애가 아닙니다.");
  console.info(
    process.env.OPS_TELEGRAM_CHAT_ID
      ? "테스트 메시지를 보냈습니다. 텔레그램에 도착했는지 확인하세요."
      : "보낼 곳이 없어 아무것도 보내지 않았습니다.",
  );
  process.exit(0);
}

if (process.argv.includes("--once")) {
  const healthy = await cycle({ verbose: true });
  process.exit(healthy ? 0 : 1);
}

console.info(`가동 감시 시작 — ${PROBE_INTERVAL_MS / 1000}초마다 확인합니다.`);
for (;;) {
  await cycle();
  await new Promise((resolve) => setTimeout(resolve, PROBE_INTERVAL_MS));
}
