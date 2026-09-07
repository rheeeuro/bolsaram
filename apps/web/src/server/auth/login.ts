/**
 * 로그인 경로 두 가지.
 *   관리자 — 이메일 + 비밀번호
 *   회원   — 전화번호 + 6자리 OTP
 *
 * 실제 SMS 발송은 연동하지 않았다. 개발 환경(DEV_EXPOSE_OTP=true)에서는 코드를
 * 서버 콘솔과 응답으로 돌려주고, 운영에서는 발송 어댑터를 붙여야 한다.
 */
import "server-only";
import { withOwner, withOwnerTx } from "@bolsaram/db";
import { DomainError } from "@bolsaram/domain";
import { env, isLoopbackDeployment } from "../env";
import { generateOtp, peppered, verifyPassword } from "../crypto";

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
/** 같은 번호로 이 간격 안에 다시 요청하면 거절한다(설계문서 §12 rate limit). */
const OTP_RESEND_COOLDOWN_MS = 30_000;

export async function loginAdmin(email: string, password: string): Promise<string> {
  // owner 커넥션: 인증 전이라 RLS 컨텍스트가 없다.
  const row = await withOwner(async (sql) => {
    const result = await sql.query<{ id: string; password_hash: string | null; role: string }>(
      `SELECT id, password_hash, role FROM users WHERE email = $1`,
      [email],
    );
    return result.rows[0] ?? null;
  });

  // 계정 존재 여부를 응답으로 구분할 수 없게 같은 메시지를 쓴다.
  const failure = new DomainError("FORBIDDEN", "이메일 또는 비밀번호가 올바르지 않습니다.");
  if (!row || row.role !== "ADMIN" || !row.password_hash) throw failure;
  if (!verifyPassword(password, row.password_hash)) throw failure;
  return row.id;
}

export type OtpIssueResult = {
  /** 개발 환경에서만 채워진다. */
  devCode?: string;
};

export async function issueLoginCode(phone: string): Promise<OtpIssueResult> {
  const code = generateOtp();
  const codeHash = peppered(env().SESSION_SECRET, `${phone}:${code}`);

  await withOwnerTx(async (sql) => {
    const recent = await sql.query<{ created_at: Date }>(
      `SELECT created_at FROM login_codes
        WHERE phone = $1 AND consumed_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [phone],
    );
    const last = recent.rows[0];
    if (last && Date.now() - last.created_at.getTime() < OTP_RESEND_COOLDOWN_MS) {
      throw new DomainError("RATE_LIMITED", "잠시 후 다시 시도해 주세요.");
    }

    // 이전 미사용 코드는 무효화한다. 여러 코드가 동시에 살아 있으면 안 된다.
    await sql.query(
      `UPDATE login_codes SET consumed_at = now()
        WHERE phone = $1 AND consumed_at IS NULL`,
      [phone],
    );
    await sql.query(
      `INSERT INTO login_codes (phone, code_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [phone, codeHash, new Date(Date.now() + OTP_TTL_MS)],
    );
  });

  if (env().DEV_EXPOSE_OTP) {
    // 서버 로그는 호스트에 접근할 수 있는 사람만 본다. 여기까지는 안전하다.
    console.info(`[dev] ${phone} 로그인 코드: ${code}`);
    // 응답에 싣는 것은 **loopback 배포에서만**. 공개 주소로 서비스되는 배포에서
    // 코드를 내려주면 인터넷의 누구나 남의 계정으로 로그인할 수 있다.
    // 공개 배포에서 코드가 필요하면 `pnpm pm2:logs` 로 확인한다.
    return isLoopbackDeployment() ? { devCode: code } : {};
  }
  // TODO(SMS 연동): APP_ENV=production 으로 올리기 전에 발송 어댑터를 붙인다.
  //   완료 조건 — 실제 문자로 코드가 도착하고 DEV_EXPOSE_OTP 없이 로그인이 된다.
  throw new DomainError(
    "INVALID_STATE",
    "문자 발송이 아직 연동되지 않았습니다. 관리자에게 문의해 주세요.",
  );
}

/** 코드 검증 후 사용자 id 를 돌려준다. 해당 번호의 회원이 없으면 만들지 않는다. */
export async function verifyLoginCode(phone: string, code: string): Promise<string> {
  const codeHash = peppered(env().SESSION_SECRET, `${phone}:${code}`);

  return withOwnerTx(async (sql) => {
    const result = await sql.query<{ id: string; attempts: number; code_hash: string }>(
      `SELECT id, attempts, code_hash FROM login_codes
        WHERE phone = $1 AND consumed_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1
        FOR UPDATE`,
      [phone],
    );
    const row = result.rows[0];
    if (!row) {
      throw new DomainError("FORBIDDEN", "코드가 만료되었습니다. 다시 요청해 주세요.");
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      await sql.query(`UPDATE login_codes SET consumed_at = now() WHERE id = $1`, [row.id]);
      throw new DomainError("RATE_LIMITED", "시도 횟수를 초과했습니다. 다시 요청해 주세요.");
    }
    if (row.code_hash !== codeHash) {
      await sql.query(`UPDATE login_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
      throw new DomainError("FORBIDDEN", "코드가 올바르지 않습니다.");
    }
    await sql.query(`UPDATE login_codes SET consumed_at = now() WHERE id = $1`, [row.id]);

    const user = await sql.query<{ id: string }>(`SELECT id FROM users WHERE phone = $1`, [
      phone,
    ]);
    const existing = user.rows[0];
    if (existing) return existing.id;

    // 초대받지 않은 번호는 가입시키지 않는다 — 볼사람은 비공개 서비스다.
    throw new DomainError(
      "FORBIDDEN",
      "초대된 번호가 아닙니다. 주선자에게 초대 링크를 요청해 주세요.",
    );
  });
}
