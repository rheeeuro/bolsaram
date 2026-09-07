/**
 * 로그인은 **주선자만** 여기를 지난다 — 이메일 + 비밀번호.
 *
 * 회원은 비밀번호가 없다. 주선자가 카카오톡으로 보낸 초대 링크가 곧 로그인이며
 * 그 경로는 `server/auth/invite.ts` 의 `consumeInvite` 다(매직 링크).
 * SMS 를 쓰지 않으므로 전화번호 OTP 경로는 제거했다(0015).
 */
import "server-only";
import { withOwner } from "@bolsaram/db";
import { DomainError } from "@bolsaram/domain";
import { verifyPassword } from "../crypto";

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
