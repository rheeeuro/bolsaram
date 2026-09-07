/**
 * 로그인 경로 두 가지.
 *   관리자 — 이메일 + 비밀번호
 *   회원   — 전화번호 + 6자리 OTP
 *
 * 인증번호 전달은 `server/sms/` 의 sender 가 담당한다. 기본 sender(`console`)는 실제로
 * 보내지 않고 서버 로그에만 남기므로, 운영 배포에는 실제 업체 어댑터가 필요하다
 * (`APP_ENV=production` + `SMS_PROVIDER=console` 조합은 기동이 거부된다).
 */
import "server-only";
import { withOwner, withOwnerTx } from "@bolsaram/db";
import { DomainError } from "@bolsaram/domain";
import { env, isLoopbackDeployment } from "../env";
import { generateOtp, peppered, verifyPassword } from "../crypto";
import { smsSender } from "../sms/index";

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
/** 같은 번호로 이 간격 안에 다시 요청하면 거절한다(설계문서 §12 rate limit). */
const OTP_RESEND_COOLDOWN_MS = 30_000;

/**
 * 관리자 비밀번호 시도 제한.
 *
 * 창 안에서 이만큼 실패하면 거절한다. 창이 지나면 자연히 풀리므로 영구 락아웃이 없다 —
 * 주선자가 여러 명이라도 특정 계정을 무기한 잠글 수 있게 만들지 않는다.
 * 판정은 이메일 문자열 기준이다. 계정 존재 여부를 응답으로 구분할 수 없게 하려면
 * 존재하지 않는 이메일로 온 시도도 같은 방식으로 세야 한다.
 */
const ADMIN_LOGIN_MAX_FAILURES = 5;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60_000;

export async function loginAdmin(email: string, password: string): Promise<string> {
  // owner 커넥션: 인증 전이라 RLS 컨텍스트가 없다.
  const row = await withOwner(async (sql) => {
    // 창 안의 실패 횟수를 먼저 본다. 비밀번호 검증(scrypt)은 비싸므로 그 앞에서 끊는다.
    const recent = await sql.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM admin_login_failures
        WHERE email = $1 AND failed_at > now() - make_interval(secs => $2)`,
      [email, ADMIN_LOGIN_WINDOW_MS / 1000],
    );
    if ((recent.rows[0]?.count ?? 0) >= ADMIN_LOGIN_MAX_FAILURES) {
      throw new DomainError(
        "RATE_LIMITED",
        `로그인 시도가 너무 많습니다. ${ADMIN_LOGIN_WINDOW_MS / 60_000}분 뒤에 다시 시도해 주세요.`,
      );
    }
    const result = await sql.query<{ id: string; password_hash: string | null; role: string }>(
      `SELECT id, password_hash, role FROM users WHERE email = $1`,
      [email],
    );
    return result.rows[0] ?? null;
  });

  // 계정 존재 여부를 응답으로 구분할 수 없게 같은 메시지를 쓴다.
  const failure = new DomainError("FORBIDDEN", "이메일 또는 비밀번호가 올바르지 않습니다.");
  const ok =
    row != null && row.role === "ADMIN" && row.password_hash != null
      ? verifyPassword(password, row.password_hash)
      : false;

  if (!ok) {
    // 실패를 남긴 뒤에 던진다. 남기지 못해도 인증 실패는 그대로 알린다.
    await withOwner((sql) =>
      sql.query(`INSERT INTO admin_login_failures (email) VALUES ($1)`, [email]),
    ).catch((error: unknown) => {
      console.error("관리자 로그인 실패 기록에 실패", error);
    });
    throw failure;
  }

  // 성공하면 창을 비운다 — 본인이 오타 몇 번 낸 뒤 맞췄으면 제한이 남지 않아야 한다.
  await withOwner((sql) =>
    sql.query(`DELETE FROM admin_login_failures WHERE email = $1`, [email]),
  ).catch((error: unknown) => {
    console.error("관리자 로그인 실패 기록 정리에 실패", error);
  });
  return row!.id;
}

export type OtpIssueResult = {
  /** loopback 배포 + DEV_EXPOSE_OTP 에서만 채워진다. 공개 배포에서는 절대 비어 있다. */
  devCode?: string;
  /** 문자가 실제로 사용자 휴대폰에 도착하는 경로였는지. 화면 안내 문구를 가른다. */
  delivered: boolean;
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

  const sender = smsSender();
  // 발송 실패는 삼키지 않는다. 코드 행은 이미 남았지만 사용자는 받지 못했으므로
  // 재요청할 수 있어야 한다(쿨다운은 30초).
  await sender.send({
    to: phone,
    text: `[볼사람] 인증번호 ${code} (5분 내 입력)`,
  });

  // 응답에 코드를 싣는 것은 **loopback 배포 + DEV_EXPOSE_OTP** 에서만.
  // 공개 주소로 서비스되는 배포에서 코드를 내려주면 인터넷의 누구나 남의 계정으로
  // 로그인할 수 있다. 공개 배포에서 코드가 필요하면 `pnpm pm2:logs` 로 확인한다.
  const expose = env().DEV_EXPOSE_OTP && isLoopbackDeployment();
  return expose
    ? { devCode: code, delivered: sender.delivers }
    : { delivered: sender.delivers };
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
