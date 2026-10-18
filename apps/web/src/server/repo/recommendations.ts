/**
 * AI 추천의 후보 고르기. RLS 트랜잭션 안에서 호출된다.
 * 견주고 순위를 매기는 것은 domain 의 recommend 다.
 */
import "server-only";
import type { Sql } from "@bolsaram/db";
import { oppositeGender } from "@bolsaram/domain";
import type { Gender } from "@bolsaram/schemas";

/** 후보를 훑는 상한. 한 쪽(모임·전체공개)의 활성 이성이 이보다 많으면 최근 순으로 자른다. */
const CANDIDATE_SCAN_LIMIT = 500;

/**
 * 이 멤버가 탐색에서 보는 사람들의 id — 탐색 목록과 같은 경계다.
 *
 * 같은 쪽(같은 모임, 또는 둘 다 전체공개)의 활성 이성이고, 거절·숨김이 있는 사이는
 * 양방향으로 뺀다(`app_discover_excluded_profile_ids`). 쪽은 보는 사람의 프로필이 정한다 —
 * 대행 중에는 커넥션 권한이 주선자의 것이라 RLS 만으로는 다른 풀까지 열린다.
 */
export async function findRecommendPoolIds(sql: Sql, viewerProfileId: string): Promise<string[]> {
  const viewer = await sql.query<{ gender: Gender; group_id: string | null }>(
    `SELECT gender, group_id FROM profiles WHERE id = $1`,
    [viewerProfileId],
  );
  const row = viewer.rows[0];
  if (!row) return [];

  const result = await sql.query<{ id: string }>(
    `SELECT p.id FROM profiles p
      WHERE p.id <> $1
        AND p.status = 'ACTIVE'
        AND p.gender = $2
        AND p.group_id IS NOT DISTINCT FROM $3
        AND p.id NOT IN (SELECT app_discover_excluded_profile_ids())
      ORDER BY COALESCE(p.bumped_at, p.created_at) DESC, p.id DESC
      LIMIT $4`,
    [viewerProfileId, oppositeGender(row.gender), row.group_id, CANDIDATE_SCAN_LIMIT],
  );
  return result.rows.map((r) => r.id);
}
