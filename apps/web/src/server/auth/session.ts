/**
 * 세션. 쿠키에는 `<sessionId>.<hmac>` 만 담고 상태는 DB 에 둔다.
 * 서버에서 즉시 폐기할 수 있어야 하기 때문에 self-contained JWT 를 쓰지 않는다.
 *
 * 세션/OTP/초대 검증은 인증 컨텍스트가 아직 없는 시점에 일어나므로
 * RLS 를 우회하는 owner 커넥션을 쓴다. 이 파일 밖에서는 owner 를 쓰지 않는다.
 */
import "server-only";
import { cookies } from "next/headers";
import { withOwner } from "@bolsaram/db";
import type { UserRole } from "@bolsaram/schemas";
import { env, isProduction } from "../env";
import { hmac, safeEqual } from "../crypto";

export const SESSION_COOKIE = "bolsaram_session";
const SESSION_TTL_DAYS = 30;

export type SessionUser = {
  userId: string;
  role: UserRole;
  displayName: string | null;
  /** Claim 이 끝난 회원만 프로필을 가진다. */
  profileId: string | null;
  /**
   * 이 사용자가 다루는 모임.
   *
   * 주선자는 `group_admins` 로 정해지고, 회원은 자기 프로필이 속한 모임이다.
   * 가입만 하고 아직 모임이 없는 주선자는 null 이며 아무 데이터도 다룰 수 없다.
   *
   * RLS 는 이 값을 믿지 않는다 — 정책이 `group_admins` 를 직접 조회한다.
   * 여기 있는 값은 애플리케이션 레이어의 중복 검사와 INSERT 시 소속 지정에 쓴다.
   */
  groupId: string | null;
};

function signSessionId(sessionId: string): string {
  return `${sessionId}.${hmac(env().SESSION_SECRET, sessionId)}`;
}

function parseCookieValue(value: string): string | null {
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const sessionId = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!safeEqual(hmac(env().SESSION_SECRET, sessionId), signature)) return null;
  return sessionId;
}

export async function createSession(userId: string, userAgent?: string): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  // owner 커넥션: sessions 테이블은 app 롤에 권한이 없다(0006_rls.sql).
  const sessionId = await withOwner(async (sql) => {
    const result = await sql.query<{ id: string }>(
      `INSERT INTO sessions (user_id, expires_at, user_agent)
       VALUES ($1, $2, $3) RETURNING id`,
      [userId, expiresAt, userAgent?.slice(0, 300) ?? null],
    );
    await sql.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userId]);
    return result.rows[0]!.id;
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, signSessionId(sessionId), {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);
  if (!raw) return;
  const sessionId = parseCookieValue(raw);
  if (!sessionId) return;
  await withOwner((sql) =>
    sql.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [sessionId]),
  );
}

/** 현재 세션 사용자. 없으면 null. 캐시하지 않으므로 요청당 한 번만 호출한다. */
export async function readSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const sessionId = parseCookieValue(raw);
  if (!sessionId) return null;

  // owner 커넥션: 인증 이전이라 RLS 컨텍스트가 없다.
  return withOwner(async (sql) => {
    const result = await sql.query<{
      user_id: string;
      role: UserRole;
      display_name: string | null;
      profile_id: string | null;
      group_id: string | null;
    }>(
      // 주선자의 모임은 group_admins, 회원의 모임은 자기 프로필에서 온다.
      // 여러 모임에 속한 주선자는 먼저 들어간 모임을 쓴다(모임 전환 UI 는 아직 없다).
      `SELECT u.id AS user_id, u.role, u.display_name, p.id AS profile_id,
              COALESCE(
                (SELECT ga.group_id FROM group_admins ga
                  WHERE ga.user_id = u.id ORDER BY ga.added_at LIMIT 1),
                p.group_id
              ) AS group_id
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN profiles p ON p.user_id = u.id
        WHERE s.id = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()`,
      [sessionId],
    );
    const row = result.rows[0];
    if (!row) return null;

    // 활동 시각 갱신은 실패해도 요청을 막지 않는다. 다만 조용히 넘기지 않고 로그를 남긴다.
    sql
      .query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [sessionId])
      .catch((error: unknown) => {
        console.error("세션 last_seen_at 갱신 실패", error);
      });

    return {
      userId: row.user_id,
      role: row.role,
      displayName: row.display_name,
      profileId: row.profile_id,
      groupId: row.group_id,
    };
  });
}
