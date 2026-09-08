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
 * 커서 페이지네이션. 정렬은 (created_at DESC, id DESC) 고정.
 * 커서는 `<iso8601>|<uuid>` 형식이며 잘못된 값은 무시하고 첫 페이지를 준다.
 */
export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.toISOString()}|${row.id}`;
}

export function decodeCursor(
  cursor: string | undefined,
): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  const sep = cursor.indexOf("|");
  if (sep < 0) return null;
  const iso = cursor.slice(0, sep);
  const id = cursor.slice(sep + 1);
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime()) || id.length === 0) return null;
  return { createdAt, id };
}
