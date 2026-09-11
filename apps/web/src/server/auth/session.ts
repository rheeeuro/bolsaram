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
  /**
   * 회원으로서 보는 프로필.
   *
   * Claim 이 끝난 회원은 자기 프로필, 주선자가 대행 중이면 그 대상이다.
   * 그래서 `asMember` · `actorFor` 같은 회원 경로가 대행에서도 그대로 동작한다.
   */
  profileId: string | null;
  /**
   * 대행 중일 때만 채워진다. 배너를 띄우고 「직접 누른 것」과 구분하는 데 쓴다.
   * 대상이 자기 계정으로 들어오는 순간(`user_id` 가 채워지면) 여기서도 사라진다.
   */
  actingProfileId: string | null;
  /**
   * 지금 보고 있는 모임(채널). **null 이면 전체공개**다.
   *
   * 주선자는 `users.active_group_id` 이고 실제 소속(`group_admins`)일 때만 살아난다 —
   * 나간 모임을 가리키고 있으면 전체공개로 떨어뜨린다. 회원은 자기 프로필의 모임이며
   * 바꿀 수 없다.
   *
   * RLS 는 이 값을 믿지 않는다 — 정책이 `group_admins` 를 직접 조회한다.
   * 여기 있는 값은 목록 화면의 채널 필터와 INSERT 시 소속 지정에 쓴다.
   */
  groupId: string | null;
  /**
   * 주선자가 속한 모임 전부. 채널 전환기가 쓴다. 회원은 빈 배열이다.
   *
   * 한 사람이 여러 모임에 속할 수 있다 — 어느 모임의 데이터를 다룰 수 있는지는
   * 이 목록이 아니라 RLS 가 정한다.
   */
  groups: { id: string; name: string }[];
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
      acting_profile_id: string | null;
      group_id: string | null;
      groups: { id: string; name: string }[];
    }>(
      // 주선자의 채널은 users.active_group_id, 회원의 모임은 자기 프로필에서 온다.
      // 주선자의 활성 채널은 **지금도 그 모임에 속해 있을 때만** 살린다 — 나간 모임을
      // 가리키고 있으면 전체공개(null)로 떨어진다. 소속 판정은 group_admins 가 하고
      // active_group_id 는 그중 어디를 보고 있는지만 말한다(0036).
      // 대행(ap)은 주선자에게만, 그리고 **지금도 고칠 수 있는 프로필일 때만** 붙는다.
      // 본인 계정이 연결된 프로필도 대상이다(0035) — 연결은 초대를 한 번 열었다는
      // 뜻일 뿐 직접 쓰고 있다는 뜻이 아니다. 대행을 시작한 뒤 모임에서 나가는 것처럼
      // 권한이 사라질 수 있으므로 세션을 읽을 때마다 다시 본다. 조건은
      // `app_can_edit_profile` 과 같고, owner 커넥션이라 RLS 컨텍스트가 없어 여기서는
      // 그 함수 대신 같은 판정을 직접 쓴다. 최종 판정은 RLS 가 한 번 더 한다.
      `SELECT u.id AS user_id, u.role, u.display_name, p.id AS profile_id,
              ap.id AS acting_profile_id,
              CASE WHEN u.role = 'ADMIN' THEN (
                     SELECT ga.group_id FROM group_admins ga
                      WHERE ga.user_id = u.id AND ga.group_id = u.active_group_id
                   )
                   ELSE p.group_id END AS group_id,
              COALESCE(
                (SELECT json_agg(json_build_object('id', g.id, 'name', g.name)
                                 ORDER BY ga.added_at)
                   FROM group_admins ga JOIN groups g ON g.id = ga.group_id
                  WHERE ga.user_id = u.id AND u.role = 'ADMIN'),
                '[]'::json
              ) AS groups
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN profiles p ON p.user_id = u.id
         LEFT JOIN profiles ap ON ap.id = s.acting_profile_id
                              AND u.role = 'ADMIN'
                              AND (
                                EXISTS (SELECT 1 FROM group_admins ga
                                         WHERE ga.user_id = u.id
                                           AND ga.group_id = ap.group_id)
                                OR (ap.group_id IS NULL AND ap.created_by = u.id)
                              )
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
      profileId: row.acting_profile_id ?? row.profile_id,
      actingProfileId: row.acting_profile_id,
      groupId: row.group_id,
      groups: row.groups,
    };
  });
}

/**
 * 대행 대상을 세션에 붙이거나 뗀다.
 *
 * 쿠키가 아니라 서버 측 상태로 둔다 — 세션을 폐기하면 대행도 같이 끝나고, 대상
 * 프로필이 지워지면 참조가 저절로 풀린다(0025). 호출부(`/api/admin/acting`)가
 * 먼저 `app_can_edit_profile` 로 권한을 확인하고, RLS 가 요청마다 한 번 더 본다.
 * 끝내는 것은 주선자이거나 세션 폐기다 — 당사자의 로그인이 대행을 닫지는 않는다(0035).
 */
export async function setActingProfile(profileId: string | null): Promise<void> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return;
  const sessionId = parseCookieValue(raw);
  if (!sessionId) return;
  // owner 커넥션: sessions 테이블은 app 롤에 권한이 없다(0006_rls.sql).
  await withOwner((sql) =>
    sql.query(`UPDATE sessions SET acting_profile_id = $2 WHERE id = $1`, [
      sessionId,
      profileId,
    ]),
  );
}
