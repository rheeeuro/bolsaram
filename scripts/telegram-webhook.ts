/**
 * 텔레그램 webhook 등록/확인.
 *
 * **토큰이 사람 손이나 작업 기록을 거치지 않게** 하려고 만들었다. 토큰은 환경 파일에만
 * 있고 이 스크립트가 직접 읽는다 — 출력에는 토큰도 시크릿도 절대 찍지 않는다.
 * 토큰이 URL 경로에 들어가므로 실패해도 URL 을 그대로 출력하지 않는다.
 *
 *   pnpm telegram:webhook          현재 등록 상태 확인
 *   pnpm telegram:webhook --set    APP_ORIGIN 기준으로 등록
 *   pnpm telegram:webhook --delete 등록 해제
 */
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { loadDotEnv } from "../packages/db/src/cli/dotenv";

// 해외 API 는 TCP 연결이 250ms(Node 기본값)를 넘어 완료 직전에 취소된다.
// 앱은 startup-node.ts 에서 같은 값을 올린다 — 스크립트도 같은 제약을 받는다.
setDefaultAutoSelectFamilyAttemptTimeout(2_000);

loadDotEnv();

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const origin = process.env.APP_ORIGIN;

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!token) fail("TELEGRAM_BOT_TOKEN 이 설정되어 있지 않습니다.");
if (!origin) fail("APP_ORIGIN 이 설정되어 있지 않습니다.");

const WEBHOOK_PATH = "/api/integrations/telegram/webhook";

async function call(method: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => fail(`${method} 호출에 실패했습니다(네트워크).`));

  const payload = (await response.json()) as {
    ok?: boolean;
    description?: string;
    result?: Record<string, unknown>;
  };
  if (!payload.ok) fail(`${method} 실패: ${payload.description ?? response.status}`);
  return (payload.result ?? {}) as Record<string, unknown>;
}

async function info(): Promise<void> {
  const me = await call("getMe");
  const hook = await call("getWebhookInfo");
  console.info(`봇          @${String(me.username ?? "?")}`);
  console.info(`등록 주소   ${String(hook.url || "(등록 안 됨)")}`);
  console.info(`보류 update ${String(hook.pending_update_count ?? 0)}`);
  if (hook.last_error_message) {
    console.info(`최근 오류   ${String(hook.last_error_message)}`);
  }
}

const mode = process.argv[2];

if (mode === "--set") {
  if (!secret) fail("TELEGRAM_WEBHOOK_SECRET 이 설정되어 있지 않습니다.");
  if (!origin.startsWith("https://")) {
    fail(`APP_ORIGIN 이 https 여야 텔레그램이 도달합니다: ${origin}`);
  }
  await call("setWebhook", {
    url: `${origin}${WEBHOOK_PATH}`,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  console.info("✓ 등록했습니다.\n");
  await info();
} else if (mode === "--delete") {
  await call("deleteWebhook", { drop_pending_updates: true });
  console.info("✓ 등록을 해제했습니다.");
} else {
  await info();
}
