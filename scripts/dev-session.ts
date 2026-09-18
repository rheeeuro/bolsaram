/**
 * 개발·점검용 주선자 세션 쿠키 발급.
 *
 * 주선자 로그인은 카카오·구글을 거친다(0050). 브라우저 동의 화면이 필요해서 curl 로는
 * 끝낼 수 없고, 그렇다고 점검용 뒷문을 앱에 두면 그게 곧 인증 우회다. 그래서 **앱 밖의
 * CLI** 로 세션 행을 직접 만든다 — 실행하는 사람이 이미 DB owner 자격 증명을 가진
 * 경우에만 동작하므로 새로 열리는 권한이 없다.
 *
 *   pnpm dev:session                     기본 점검 계정으로
 *   pnpm dev:session admin@example.com   특정 주선자로 (없으면 만든다)
 *
 * 출력한 쿠키를 그대로 쓴다:
 *   curl -b "$(pnpm -s dev:session)" http://127.0.0.1:3020/home
 *
 * `APP_ENV=production` 에서는 거절한다. 실제 사용자를 받는 배포에서 이 경로가 돌아가야
 * 할 이유가 없다.
 */
import { createHmac } from "node:crypto";
import { closePools, withOwnerTx } from "../packages/db/src/client";
import { loadDotEnv } from "../packages/db/src/cli/dotenv";

loadDotEnv();

const SESSION_COOKIE = "bolsaram_session";
const TTL_DAYS = 1;
const DEFAULT_EMAIL = "dev-check@bolsaram.local";

async function main(): Promise<void> {
  if (process.env.APP_ENV === "production") {
    throw new Error("APP_ENV=production 에서는 쓸 수 없습니다.");
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET 이 설정돼 있지 않습니다.");

  const email = process.argv[2]?.trim() || DEFAULT_EMAIL;
  const cookie = await withOwnerTx(async (sql) => {
    const found = await sql.query<{ id: string; role: string }>(
      `SELECT id, role FROM users WHERE email = $1`,
      [email],
    );
    if (found.rows[0] && found.rows[0].role !== "ADMIN") {
      throw new Error(`${email} 는 주선자 계정이 아닙니다.`);
    }
    let userId = found.rows[0]?.id;
    if (!userId) {
      const created = await sql.query<{ id: string }>(
        `INSERT INTO users (role, email, display_name) VALUES ('ADMIN', $1, '점검')
         RETURNING id`,
        [email],
      );
      userId = created.rows[0]!.id;
    }
    const session = await sql.query<{ id: string }>(
      `INSERT INTO sessions (user_id, expires_at, user_agent)
       VALUES ($1, now() + make_interval(days => $2), 'dev-session CLI')
       RETURNING id`,
      [userId, TTL_DAYS],
    );
    const id = session.rows[0]!.id;
    const signature = createHmac("sha256", secret).update(id).digest("base64url");
    return `${SESSION_COOKIE}=${id}.${signature}`;
  });

  // 파이프로 바로 넘길 수 있게 쿠키 한 줄만 표준출력으로 낸다. 안내는 stderr 로.
  console.error(`주선자 ${email} · ${TTL_DAYS}일 유효`);
  console.info(cookie);
}

main()
  .then(() => closePools())
  .catch(async (error: unknown) => {
    console.error(error);
    await closePools();
    process.exitCode = 1;
  });
