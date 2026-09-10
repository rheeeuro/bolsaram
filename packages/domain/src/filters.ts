/**
 * Discover 필터를 SQL 조각으로 바꾼다.
 * 필터 의미를 한 곳에 모아 테스트 가능하게 하고, 값은 항상 파라미터로만 넘긴다.
 */
import type { DiscoverQuery } from "@bolsaram/schemas";

export type SqlFragment = { text: string; values: unknown[] };

export type FilterContext = {
  /** 나 자신은 리스트에서 제외한다. */
  viewerProfileId: string | null;
  /** 기준 연도. 나이 → 출생연도 변환에 쓴다. */
  currentYear: number;
};

/**
 * 나이 범위를 출생연도 범위로 뒤집는다.
 * 만 나이 기준이므로 ageMin 이 클수록 birthYear 는 작아진다.
 */
export function birthYearRange(
  query: Pick<DiscoverQuery, "ageMin" | "ageMax">,
  currentYear: number,
): { min?: number; max?: number } {
  const out: { min?: number; max?: number } = {};
  if (query.ageMax != null) out.min = currentYear - query.ageMax;
  if (query.ageMin != null) out.max = currentYear - query.ageMin;
  return out;
}

/**
 * WHERE 절을 만든다. `$1` 부터 시작하는 자리표시자 번호를 `startIndex` 로 이어붙일 수 있다.
 * 반환 text 는 항상 `TRUE` 로 시작해 빈 필터에서도 유효한 SQL 이 된다.
 */
export function buildDiscoverWhere(
  query: DiscoverQuery,
  ctx: FilterContext,
  startIndex = 1,
): SqlFragment {
  const clauses: string[] = ["p.status IN ('ACTIVE','MATCHING')", "p.visibility = 'LISTED'"];
  const values: unknown[] = [];
  let i = startIndex;
  const push = (value: unknown) => {
    values.push(value);
    return `$${i++}`;
  };

  if (ctx.viewerProfileId) {
    clauses.push(`p.id <> ${push(ctx.viewerProfileId)}`);
    // 거절·숨김 관계는 양방향으로 목록에서 뺀다(마이그레이션 0023). 판정을 SQL 함수에
    // 두는 이유는 "상대가 나를 숨겼다" 는 RLS 로 보이지 않는 사실이라서다 — 여기서
    // 서브쿼리로 직접 훑으면 그 방향이 빠진다.
    clauses.push(`p.id NOT IN (SELECT app_discover_excluded_profile_ids())`);
  }
  if (query.gender) clauses.push(`p.gender = ${push(query.gender)}`);

  const years = birthYearRange(query, ctx.currentYear);
  if (years.min != null) clauses.push(`p.birth_year >= ${push(years.min)}`);
  if (years.max != null) clauses.push(`p.birth_year <= ${push(years.max)}`);

  if (query.heightMin != null) clauses.push(`p.height >= ${push(query.heightMin)}`);
  if (query.heightMax != null) clauses.push(`p.height <= ${push(query.heightMax)}`);

  if (query.regions?.length) {
    clauses.push(`p.residence_region = ANY(${push(query.regions)})`);
  }
  if (query.jobCategories?.length) {
    clauses.push(`p.job_category = ANY(${push(query.jobCategories)})`);
  }
  if (query.religions?.length) {
    clauses.push(`p.religion = ANY(${push(query.religions)})`);
  }
  if (query.smoking?.length) {
    clauses.push(`p.smoking = ANY(${push(query.smoking)})`);
  }
  if (query.drinking?.length) {
    clauses.push(`p.drinking = ANY(${push(query.drinking)})`);
  }

  if (query.q) {
    // 자유 검색은 공개 범위 안의 텍스트만 훑는다. 이름/연락처는 대상이 아니다.
    const term = push(`%${query.q}%`);
    clauses.push(
      `(p.bio ILIKE ${term} OR p.ideal_type_text ILIKE ${term} OR p.job_title ILIKE ${term} OR array_to_string(p.hobbies, ' ') ILIKE ${term})`,
    );
  }

  return { text: clauses.join(" AND "), values };
}

/**
 * 사진 유무 판정식. `profiles p` 별칭을 전제한다.
 * 정렬과 커서 비교가 **같은 식**을 봐야 페이지 경계에서 행이 새거나 겹치지 않는다.
 */
export const HAS_PHOTO_SQL =
  "EXISTS (SELECT 1 FROM profile_images pi WHERE pi.profile_id = p.id)";

/**
 * 목록 정렬. 사진 없는 프로필을 뒤로 민다 — 카드 그리드가 빈 회색으로 시작하면
 * 첫 화면이 못 쓰게 된다. 사진 유무 안에서는 최신순이 그대로 유지된다.
 * 세 키 모두 DESC 라 커서는 튜플 비교 하나로 이어진다(boolean 은 false < true).
 */
export const PROFILE_ORDER_BY = `${HAS_PHOTO_SQL} DESC, p.created_at DESC, p.id DESC`;

export type ProfileCursor = { hasPhoto: boolean; createdAt: Date; id: string };

/**
 * 커서 페이지네이션. 정렬 키와 같은 순서로 `<0|1>|<iso8601>|<uuid>` 를 싣는다.
 * 잘못된 값은 무시하고 첫 페이지를 준다.
 */
export function encodeCursor(row: ProfileCursor): string {
  return `${row.hasPhoto ? "1" : "0"}|${row.createdAt.toISOString()}|${row.id}`;
}

export function decodeCursor(cursor: string | undefined): ProfileCursor | null {
  if (!cursor) return null;
  const parts = cursor.split("|");
  if (parts.length !== 3) return null;
  const [flag, iso, id] = parts as [string, string, string];
  if (flag !== "0" && flag !== "1") return null;
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime()) || id.length === 0) return null;
  return { hasPhoto: flag === "1", createdAt, id };
}
