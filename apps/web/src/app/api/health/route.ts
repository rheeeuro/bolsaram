/**
 * GET /api/health — 가동 확인
 *
 * **로그인을 요구하지 않는다.** 밖에서 「살아 있는가」를 물어야 하는 경로이고,
 * 답에는 개인정보도 설정값도 담기지 않는다(상태 두 글자뿐이다).
 *
 * DB 까지 확인하는 이유: 프로세스가 떠 있어도 Postgres 가 죽었거나 커넥션이 마르면
 * 모든 화면이 오류가 된다. 앱 롤(`withRls`)로 확인해 실제 요청과 같은 길을 지난다.
 *
 * 환경변수 가드에 걸린 경우는 여기서 판정하지 않는다 — 그때는 `instrumentation` 훅이
 * 던져서 이 라우트를 포함한 모든 요청이 500 이 된다. 감시기가 그 500 을 본다.
 */
import { ANONYMOUS, withRls } from "@bolsaram/db";
import { ok, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

/**
 * 공개 경로라 부르는 만큼 DB 를 두드리게 두지 않는다. 감시 주기는 분 단위이므로
 * 몇 초만 재사용해도 감시 정확도는 그대로고 남이 두드려도 부하가 늘지 않는다.
 */
const PROBE_CACHE_MS = 3_000;

let cached: { at: number; healthy: boolean } | null = null;

async function probeDb(): Promise<boolean> {
  const now = Date.now();
  if (cached && now - cached.at < PROBE_CACHE_MS) return cached.healthy;

  let healthy: boolean;
  try {
    await withRls(ANONYMOUS, (sql) => sql.query("SELECT 1"));
    healthy = true;
  } catch (error) {
    // 원인은 로그에만 남긴다. 응답에 실으면 접속 문자열이 새어 나갈 수 있다.
    console.error("헬스체크 DB 확인 실패:", error instanceof Error ? error.message : error);
    healthy = false;
  }

  cached = { at: now, healthy };
  return healthy;
}

export const GET = route(async () => {
  const db = await probeDb();
  return ok(
    { status: db ? "ok" : "degraded", db: db ? "ok" : "fail" },
    {
      status: db ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
});
