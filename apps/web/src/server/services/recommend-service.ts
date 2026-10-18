/**
 * AI 추천 — 멤버 탐색의 「AI 추천」 표시와 「AI 추천만」 필터가 쓰는 집합.
 *
 * 이상형 조건은 가져오기 때 AI 추출이 함께 뽑아 프로필 항목(`ideal_criteria`)으로 저장해
 * 두었다. 여기서는 **AI 를 부르지 않는다** — 보는 멤버와 그 사람의 탐색 풀을 읽고 domain 의
 * `rankRecommendations` 로 견주기만 한다. 보는 멤버의 조건이 비어 있으면 상대의 이상형에
 * 이 멤버가 맞는 사람을 고른다.
 */
import "server-only";
import type { Sql } from "@bolsaram/db";
import { rankRecommendations, type RecommendSubject } from "@bolsaram/domain";
import { findProfileById, findProfilesByIds, type ProfileRecord } from "../repo/profiles";
import { findRecommendPoolIds } from "../repo/recommendations";

function toSubject(profile: ProfileRecord): RecommendSubject {
  return {
    id: profile.id,
    gender: profile.gender,
    birthYear: profile.birthYear,
    height: profile.height,
    residenceRegion: profile.residenceRegion,
    workplaceRegion: profile.workplaceRegion,
    religion: profile.religion,
    smoking: profile.smoking,
    drinking: profile.drinking,
    jobCategory: profile.jobCategory,
    hobbies: profile.hobbies,
    hashtags: profile.hashtags,
    criteria: profile.idealCriteria,
  };
}

/**
 * 이 멤버에게 AI 추천인 사람들의 id. RLS 트랜잭션 안에서 부른다.
 * 멤버 프로필이 없는 세션(대행 중이 아닌 주선자)에는 빈 집합이다.
 */
export async function recommendedIdsFor(
  sql: Sql,
  viewerProfileId: string | null,
): Promise<Set<string>> {
  if (!viewerProfileId) return new Set();
  const viewer = await findProfileById(sql, viewerProfileId);
  if (!viewer) return new Set();
  const pool = await findProfilesByIds(sql, await findRecommendPoolIds(sql, viewerProfileId));
  const ranked = rankRecommendations(toSubject(viewer), pool.map(toSubject));
  return new Set(ranked.map((r) => r.candidateId));
}

/**
 * 상세 화면 한 사람에 대한 같은 판정. 풀을 훑지 않고 그 사람만 견준다 — 같은 규칙이라
 * 목록의 표시와 상세의 표시가 갈리지 않는다. 경계(같은 쪽·이성)는 부르는 쪽이 이미 확인했다.
 */
export async function isRecommendedFor(
  sql: Sql,
  viewerProfileId: string | null,
  target: ProfileRecord,
): Promise<boolean> {
  if (!viewerProfileId || viewerProfileId === target.id) return false;
  const viewer = await findProfileById(sql, viewerProfileId);
  if (!viewer) return false;
  return rankRecommendations(toSubject(viewer), [toSubject(target)]).length > 0;
}
