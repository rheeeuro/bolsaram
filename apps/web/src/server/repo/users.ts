/**
 * 내 계정. 지금은 표시 이름 하나뿐이다.
 *
 * `users_self_update` 정책이 본인 행만 통과시키고, 런타임 롤에는 `display_name` 을
 * 포함한 몇 개 컬럼의 UPDATE 권한만 있다(0036). 그래도 `WHERE id = $1` 을 명시해
 * 의도를 드러낸다 — 권한 검사는 RLS 와 여기 두 곳에 둔다.
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
