/**
 * 내 계정 — 표시 이름과 프로필 사진.
 *
 * `users_self_update` 정책이 본인 행만 통과시키고, 런타임 롤에는 `display_name` ·
 * `avatar_key` 를 포함한 몇 개 컬럼의 UPDATE 권한만 있다(0036·0051). 그래도
 * `WHERE id = $1` 을 명시해 의도를 드러낸다 — 권한 검사는 RLS 와 여기 두 곳에 둔다.
 */
import "server-only";
import type { Sql } from "@bolsaram/db";

export async function updateDisplayName(
  sql: Sql,
  userId: string,
  displayName: string,
): Promise<void> {
  await sql.query(`UPDATE users SET display_name = $2 WHERE id = $1`, [userId, displayName]);
}

/**
 * 프로필 사진을 바꾸거나(`storageKey`) 지운다(`null`).
 *
 * 밀려난 사진의 저장 키를 돌려주므로 호출부가 실제 파일도 지운다 — 프로필 사진
 * 삭제(`profile-images.ts`)와 같은 계약이다. 사진이 없는 상태가 정상이므로
 * 지우는 것을 특별히 취급하지 않는다(화면이 앞글자를 그린다).
 */
export async function updateAvatarKey(
  sql: Sql,
  userId: string,
  storageKey: string | null,
): Promise<{ previousKey: string | null }> {
  // 밀려나는 키는 바꾸기 **전에** 읽는다. 같은 RLS 트랜잭션 안이라 둘 사이에 끼어들
  // 다른 요청이 없다.
  const previous = await sql.query<{ avatar_key: string | null }>(
    `SELECT avatar_key FROM users WHERE id = $1`,
    [userId],
  );
  await sql.query(`UPDATE users SET avatar_key = $2 WHERE id = $1`, [userId, storageKey]);
  return { previousKey: previous.rows[0]?.avatar_key ?? null };
}
