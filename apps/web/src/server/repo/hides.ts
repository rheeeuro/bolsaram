/**
 * 숨기기 저장소 (마이그레이션 0023).
 *
 * favorites 와 달리 user_id 가 아니라 profile_id 로 잡는다 — 탐색 제외와 신청 차단이
 * 프로필 단위 판정이기 때문이다. 그래서 프로필이 연결되지 않은 사용자는 숨길 수 없다.
 *
 * RLS 는 **자기가 숨긴 행만** 보여준다. 그래서 "상대가 나를 숨겼는가" 는 여기서 SQL 로
 * 훑을 수 없고, DEFINER 함수 `app_is_hidden_between` 이 boolean 만 돌려준다.
 */
import "server-only";
import type { Sql } from "@bolsaram/db";

export async function addHide(
  sql: Sql,
  hiderProfileId: string,
  hiddenProfileId: string,
): Promise<void> {
  await sql.query(
    `INSERT INTO profile_hides (hider_profile_id, hidden_profile_id) VALUES ($1, $2)
     ON CONFLICT (hider_profile_id, hidden_profile_id) DO NOTHING`,
    [hiderProfileId, hiddenProfileId],
  );
}

export async function removeHide(
  sql: Sql,
  hiderProfileId: string,
  hiddenProfileId: string,
): Promise<void> {
  await sql.query(
    `DELETE FROM profile_hides WHERE hider_profile_id = $1 AND hidden_profile_id = $2`,
    [hiderProfileId, hiddenProfileId],
  );
}

/**
 * 어느 방향이든 숨긴 관계인가. 신청 가능 여부와 상세 화면의 버튼 상태에 쓴다.
 * 방향을 돌려주지 않는 것이 의도다 — 누가 숨겼는지 알려주면 숨기기가 통보가 된다.
 */
export async function isHiddenBetween(
  sql: Sql,
  otherProfileId: string,
): Promise<boolean> {
  const result = await sql.query<{ hidden: boolean }>(
    `SELECT app_is_hidden_between($1) AS hidden`,
    [otherProfileId],
  );
  return result.rows[0]?.hidden ?? false;
}

/**
 * **내가** 이 사람을 숨겼는가. 상세 화면에서 「숨기기」와 「숨김 해제」를 가르는 데 쓴다.
 * RLS 가 자기 행만 보여주므로 이 조회는 반대 방향을 절대 집지 않는다.
 */
export async function didHide(
  sql: Sql,
  hiderProfileId: string,
  hiddenProfileId: string,
): Promise<boolean> {
  const result = await sql.query(
    `SELECT 1 FROM profile_hides WHERE hider_profile_id = $1 AND hidden_profile_id = $2`,
    [hiderProfileId, hiddenProfileId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** 내가 숨긴 프로필 id. 해제 화면 목록에 쓴다(내가 숨긴 것만 해제할 수 있다). */
export async function hiddenProfileIds(sql: Sql, hiderProfileId: string): Promise<string[]> {
  const result = await sql.query<{ hidden_profile_id: string }>(
    `SELECT hidden_profile_id FROM profile_hides
      WHERE hider_profile_id = $1
      ORDER BY created_at DESC LIMIT 500`,
    [hiderProfileId],
  );
  return result.rows.map((r) => r.hidden_profile_id);
}
