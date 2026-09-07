/** 관심 저장. RLS 가 본인 행만 허용하므로 여기서는 조건을 중복해서 걸지 않아도 되지만,
 *  명시적으로 user_id 를 넣어 의도를 드러낸다. */
import "server-only";
import type { Sql } from "@bolsaram/db";

export async function addFavorite(sql: Sql, userId: string, profileId: string): Promise<void> {
  await sql.query(
    `INSERT INTO favorites (user_id, profile_id) VALUES ($1, $2)
     ON CONFLICT (user_id, profile_id) DO NOTHING`,
    [userId, profileId],
  );
}

export async function removeFavorite(
  sql: Sql,
  userId: string,
  profileId: string,
): Promise<void> {
  await sql.query(`DELETE FROM favorites WHERE user_id = $1 AND profile_id = $2`, [
    userId,
    profileId,
  ]);
}

export async function isFavorited(
  sql: Sql,
  userId: string,
  profileId: string,
): Promise<boolean> {
  const result = await sql.query(
    `SELECT 1 FROM favorites WHERE user_id = $1 AND profile_id = $2`,
    [userId, profileId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function favoriteProfileIds(sql: Sql, userId: string): Promise<string[]> {
  const result = await sql.query<{ profile_id: string }>(
    `SELECT profile_id FROM favorites WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`,
    [userId],
  );
  return result.rows.map((r) => r.profile_id);
}

/** 리스트 화면에서 하트 상태를 한 번에 채운다. */
export async function favoriteSet(
  sql: Sql,
  userId: string,
  profileIds: string[],
): Promise<Set<string>> {
  if (profileIds.length === 0) return new Set();
  const result = await sql.query<{ profile_id: string }>(
    `SELECT profile_id FROM favorites WHERE user_id = $1 AND profile_id = ANY($2)`,
    [userId, profileIds],
  );
  return new Set(result.rows.map((r) => r.profile_id));
}
