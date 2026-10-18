/**
 * Discover 필터를 SQL 조각으로 바꾼다.
 * 필터 의미를 한 곳에 모아 테스트 가능하게 하고, 값은 항상 파라미터로만 넘긴다.
 */
import { districtsOfAreas, type DiscoverQuery, type Gender } from "@bolsaram/schemas";
import { oppositeGender } from "./visibility";

export type SqlFragment = { text: string; values: unknown[] };

export type FilterContext = {
  /** 나 자신은 리스트에서 제외한다. */
  viewerProfileId: string | null;
  /**
   * 보는 사람의 성별. 목록은 **이성만** 보여주므로 이 값이 곧 필터다.
   * 멤버가 고를 수 있는 값이 아니다 — 프로필에 적힌 성별을 그대로 쓴다.
   * null 이면(프로필이 없는 주선자) 좁히지 않는다.
   */
  viewerGender: Gender | null;
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

/** 멤버 탐색과 주선자 목록이 함께 거는 인적 조건. 쿼리스트링에서 온 값 그대로다. */
export type ProfileAttributeFilter = Pick<
  DiscoverQuery,
  | "ageMin"
  | "ageMax"
  | "heightMin"
  | "heightMax"
  | "regions"
  | "areas"
  | "jobCategories"
  | "religions"
  | "smoking"
  | "drinking"
  | "tags"
>;

/**
 * 인적 조건 → WHERE 절 목록. 멤버 탐색과 주선자 목록이 **같은 절**을 쓴다 —
 * 한쪽만 고치면 주선자가 고른 조건과 멤버가 보는 결과가 어긋난다.
 * 자리표시자 번호는 부르는 쪽의 `push` 가 매긴다.
 */
export function buildAttributeClauses(
  query: ProfileAttributeFilter,
  currentYear: number,
  push: (value: unknown) => string,
): string[] {
  const clauses: string[] = [];

  const years = birthYearRange(query, currentYear);
  if (years.min != null) clauses.push(`p.birth_year >= ${push(years.min)}`);
  if (years.max != null) clauses.push(`p.birth_year <= ${push(years.max)}`);

  if (query.heightMin != null) clauses.push(`p.height >= ${push(query.heightMin)}`);
  if (query.heightMax != null) clauses.push(`p.height <= ${push(query.heightMax)}`);

  // 지역은 광역 전체(`regions`)와 서울·경기 권역(`areas`)을 함께 고를 수 있다 — 「부산」과
  // 「강남·서초」를 고르면 둘 중 하나에 사는 사람이다. 광역 전체는 세부 지역이 비어 있는
  // 사람까지 넣고, 권역은 그 권역의 구·시·군을 가진 사람만 넣는다.
  const districts = query.areas?.length ? districtsOfAreas(query.areas) : [];
  if (query.regions?.length && districts.length) {
    clauses.push(
      `(p.residence_region = ANY(${push(query.regions)}) OR p.residence_district = ANY(${push(districts)}))`,
    );
  } else if (query.regions?.length) {
    clauses.push(`p.residence_region = ANY(${push(query.regions)})`);
  } else if (districts.length) {
    clauses.push(`p.residence_district = ANY(${push(districts)})`);
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

  // 해시태그는 여러 개를 주면 좁힌다 — 「#여행 #운동」 은 둘 다 가진 사람이다.
  // 저장값도 쿼리값도 normalizeHashtags 를 지나므로 배열 포함 연산으로 바로 맞는다.
  if (query.tags?.length) {
    clauses.push(`p.hashtags @> ${push(query.tags)}`);
  }

  return clauses;
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
  const clauses: string[] = ["p.status = 'ACTIVE'"];
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
    // 멤버는 자기 풀 안만 본다. RLS 가 이미 같은 경계를 긋지만 **대행 중에는 아니다** —
    // 그때 커넥션의 권한은 주선자의 것이라 전체공개 풀과 그 주선자의 다른 모임까지
    // 열린다. 판정은 보는 사람의 프로필이 정하므로 대행에서도 그 멤버 기준이다.
    clauses.push(`p.group_id IS NOT DISTINCT FROM app_current_member_group()`);
  }
  // 이성만 본다. 화면에 성별 선택이 없고 주소로 넣을 수도 없다 — 볼 수 있는 성별은
  // 보는 사람의 프로필이 정한다(`isOppositeGender`).
  if (ctx.viewerGender) {
    clauses.push(`p.gender = ${push(oppositeGender(ctx.viewerGender))}`);
  }

  clauses.push(...buildAttributeClauses(query, ctx.currentYear, push));

  // 앞의 `#` 은 태그 표기일 뿐 저장값에는 없다. 떼고 찾는다.
  const needle = query.q?.replace(/^#+/u, "").trim();
  if (needle) {
    // 자유 검색은 공개 범위 안의 텍스트만 훑는다. 이름/연락처는 대상이 아니다.
    const term = push(`%${needle}%`);
    clauses.push(
      `(p.bio ILIKE ${term} OR p.ideal_type_text ILIKE ${term} OR p.job_title ILIKE ${term} OR array_to_string(p.hobbies, ' ') ILIKE ${term} OR array_to_string(p.hashtags, ' ') ILIKE ${term})`,
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
 * 목록에 올라온 시각. 끌어올렸으면 그 시각, 아니면 등록 시각이다(0062).
 * 정렬·커서·인덱스가 모두 이 식을 봐야 페이지 경계에서 행이 새거나 겹치지 않는다.
 */
export const PROFILE_LISTED_AT_SQL = "COALESCE(p.bumped_at, p.created_at)";

/**
 * 활성 판정식. 멤버 목록은 활성만 걸러 오므로 언제나 참이고, 주선자 목록에서만
 * 비활성을 뒤로 미는 키가 된다.
 */
export const IS_ACTIVE_SQL = "(p.status = 'ACTIVE')";

/**
 * 목록 정렬. 비활성을 맨 뒤로, 그 앞에서 사진 없는 프로필을 뒤로 민다 — 카드 그리드가
 * 빈 회색이나 흑백으로 시작하면 첫 화면이 못 쓰게 된다. 그 안에서는 올라온 순(끌어올림 포함)이다.
 * 네 키 모두 DESC 라 커서는 튜플 비교 하나로 이어진다(boolean 은 false < true).
 */
export const PROFILE_ORDER_BY = `${IS_ACTIVE_SQL} DESC, ${HAS_PHOTO_SQL} DESC, ${PROFILE_LISTED_AT_SQL} DESC, p.id DESC`;

/** 커서가 정렬 키와 같은 튜플을 보는 비교식. 값 자리 넷을 받는다. */
export function profileCursorClause(
  active: string,
  hasPhoto: string,
  listedAt: string,
  id: string,
): string {
  return `(${IS_ACTIVE_SQL}, ${HAS_PHOTO_SQL}, ${PROFILE_LISTED_AT_SQL}, p.id) < (${active}, ${hasPhoto}, ${listedAt}, ${id})`;
}

export type ProfileCursor = { active: boolean; hasPhoto: boolean; listedAt: Date; id: string };

/**
 * 커서 페이지네이션. 정렬 키와 같은 순서로 `<0|1>|<0|1>|<iso8601>|<uuid>` 를 싣는다.
 * 잘못된 값은 무시하고 첫 페이지를 준다.
 */
export function encodeCursor(row: ProfileCursor): string {
  return `${row.active ? "1" : "0"}|${row.hasPhoto ? "1" : "0"}|${row.listedAt.toISOString()}|${row.id}`;
}

export function decodeCursor(cursor: string | undefined): ProfileCursor | null {
  if (!cursor) return null;
  const parts = cursor.split("|");
  if (parts.length !== 4) return null;
  const [active, photo, iso, id] = parts as [string, string, string, string];
  if (!isFlag(active) || !isFlag(photo)) return null;
  const listedAt = new Date(iso);
  if (Number.isNaN(listedAt.getTime()) || id.length === 0) return null;
  return { active: active === "1", hasPhoto: photo === "1", listedAt, id };
}

function isFlag(value: string): boolean {
  return value === "0" || value === "1";
}
