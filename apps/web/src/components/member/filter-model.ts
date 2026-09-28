import {
  DRINKING_LABELS,
  JOB_CATEGORY_LABELS,
  REGION_LABELS,
  RELIGION_LABELS,
  SMOKING_LABELS,
  formatHashtag,
  normalizeHashtags,
} from "@bolsaram/schemas";

/**
 * 조건의 순수 모델. 멤버 탐색과 주선자 프로필 목록이 함께 쓴다. 화면과 떨어뜨려 테스트 가능하게 둔다.
 *
 * 핵심 규약: **경계가 슬라이더 끝에 붙어 있으면 제한이 아니다.**
 * 기본값이 곧 양끝이므로 손대지 않으면 아무 조건도 걸리지 않고,
 * 한쪽만 옮기면 그쪽만 걸린다. 화면에 적히는 문구도 같은 규약을 따른다.
 */

export type Filters = {
  ageMin: number;
  ageMax: number;
  heightMin: number;
  heightMax: number;
  regions: string[];
  jobCategories: string[];
  religions: string[];
  smoking: string[];
  drinking: string[];
  /** 해시태그. 열거형이 아니라 프로필에서 올라온 자유 태그다. 여러 개면 전부 가진 사람만 남는다. */
  tags: string[];
};

/** 슬라이더가 표현하는 폭. 도메인 유효범위가 아니라 화면에서 고를 수 있는 범위다. */
export const AGE_RANGE = { min: 20, max: 55 } as const;
export const HEIGHT_RANGE = { min: 145, max: 200 } as const;

export const DEFAULT_FILTERS: Filters = {
  ageMin: AGE_RANGE.min,
  ageMax: AGE_RANGE.max,
  heightMin: HEIGHT_RANGE.min,
  heightMax: HEIGHT_RANGE.max,
  regions: [],
  jobCategories: [],
  religions: [],
  smoking: [],
  drinking: [],
  tags: [],
};

const CHIP_KEYS = [
  "regions",
  "jobCategories",
  "religions",
  "smoking",
  "drinking",
  "tags",
] as const;

/**
 * 끝에서 벗어난 경계만 쿼리로 보낸다. 끝에 붙은 쪽은 절을 만들지 않는다.
 * 성별은 여기 없다 — 멤버는 이성만 보고, 그 값은 서버가 프로필에서 읽는다.
 */
export function filtersToParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.ageMin > AGE_RANGE.min) params.set("ageMin", String(filters.ageMin));
  if (filters.ageMax < AGE_RANGE.max) params.set("ageMax", String(filters.ageMax));
  if (filters.heightMin > HEIGHT_RANGE.min) {
    params.set("heightMin", String(filters.heightMin));
  }
  if (filters.heightMax < HEIGHT_RANGE.max) {
    params.set("heightMax", String(filters.heightMax));
  }
  for (const key of CHIP_KEYS) {
    if (filters[key].length > 0) params.set(key, filters[key].join(","));
  }
  return params;
}

/** 실제로 걸린 조건 개수. 필터 버튼 배지에 쓴다. */
export function activeFilterCount(filters: Filters): number {
  let count = 0;
  if (filters.ageMin > AGE_RANGE.min || filters.ageMax < AGE_RANGE.max) count += 1;
  if (filters.heightMin > HEIGHT_RANGE.min || filters.heightMax < HEIGHT_RANGE.max) count += 1;
  for (const key of CHIP_KEYS) {
    if (filters[key].length > 0) count += 1;
  }
  return count;
}

/**
 * 지금 걸린 조건을 그대로 읽어준다.
 * 끝에 붙은 경계는 제한이 아니므로 "이상"·"이하"·"전체" 로 말한다.
 */
export function rangeLabel({
  min,
  max,
  valueMin,
  valueMax,
  unit,
}: {
  min: number;
  max: number;
  valueMin: number;
  valueMax: number;
  unit: string;
}): string {
  const openLow = valueMin <= min;
  const openHigh = valueMax >= max;
  if (openLow && openHigh) return "전체";
  if (openLow) return `${valueMax}${unit} 이하`;
  if (openHigh) return `${valueMin}${unit} 이상`;
  return `${valueMin}${unit} – ${valueMax}${unit}`;
}

/**
 * 주소의 조건 → 화면 모델. `filtersToParams` 의 역이다.
 * 이상한 값은 버리고 기본값(끝)으로 둔다 — 서버도 같은 값을 스키마로 걸러낸다.
 */
export function filtersFromParams(params: URLSearchParams): Filters {
  const bound = (key: string, fallback: number, range: { min: number; max: number }) => {
    const value = Number(params.get(key));
    if (!params.has(key) || !Number.isInteger(value)) return fallback;
    return Math.min(range.max, Math.max(range.min, value));
  };
  const list = (key: string) =>
    (params.get(key) ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);

  return {
    ageMin: bound("ageMin", AGE_RANGE.min, AGE_RANGE),
    ageMax: bound("ageMax", AGE_RANGE.max, AGE_RANGE),
    heightMin: bound("heightMin", HEIGHT_RANGE.min, HEIGHT_RANGE),
    heightMax: bound("heightMax", HEIGHT_RANGE.max, HEIGHT_RANGE),
    regions: list("regions"),
    jobCategories: list("jobCategories"),
    religions: list("religions"),
    smoking: list("smoking"),
    drinking: list("drinking"),
    tags: normalizeHashtags(list("tags")),
  };
}

/** 두 자리 연도. 카카오톡 프로필이 쓰는 「96년생」 표기다. */
const yy = (year: number) => String(year % 100).padStart(2, "0");

/**
 * 나이 범위를 출생연도로 읽어준다 — 주선자는 「93~96년생」으로 생각한다.
 * 서버가 나이를 출생연도로 바꾸는 식(`birthYearRange`)과 같은 계산이다.
 * 끝에 붙은 쪽은 제한이 아니므로 「이전」·「이후」로 말하고, 양쪽이 열려 있으면 null 이다.
 */
export function birthYearLabel(
  ageMin: number,
  ageMax: number,
  currentYear: number,
): string | null {
  const openLow = ageMin <= AGE_RANGE.min;
  const openHigh = ageMax >= AGE_RANGE.max;
  const oldest = currentYear - ageMax;
  const youngest = currentYear - ageMin;
  if (openLow && openHigh) return null;
  if (openLow) return `${yy(oldest)}년생 이후`;
  if (openHigh) return `${yy(youngest)}년생 이전`;
  return oldest === youngest ? `${yy(oldest)}년생` : `${yy(oldest)}~${yy(youngest)}년생`;
}

/** 걸린 조건 하나. 목록 위에 지울 수 있는 칩으로 늘어놓는다. */
export type FilterSummaryItem = {
  key: "age" | "height" | (typeof CHIP_KEYS)[number];
  label: string;
};

const CHIP_LABELS: Record<Exclude<(typeof CHIP_KEYS)[number], "tags">, Record<string, string>> = {
  regions: REGION_LABELS,
  jobCategories: JOB_CATEGORY_LABELS,
  religions: RELIGION_LABELS,
  smoking: SMOKING_LABELS,
  drinking: DRINKING_LABELS,
};

/**
 * 지금 걸린 조건을 칩 문구로. 배지 숫자(`activeFilterCount`)와 같은 단위로 센다 —
 * 칩이 셋인데 배지가 넷이면 어느 조건이 걸렸는지 찾을 수 없다.
 */
export function filterSummary(filters: Filters, currentYear: number): FilterSummaryItem[] {
  const items: FilterSummaryItem[] = [];
  if (filters.ageMin > AGE_RANGE.min || filters.ageMax < AGE_RANGE.max) {
    items.push({
      key: "age",
      label:
        birthYearLabel(filters.ageMin, filters.ageMax, currentYear) ??
        rangeLabel({ ...AGE_RANGE, valueMin: filters.ageMin, valueMax: filters.ageMax, unit: "세" }),
    });
  }
  if (filters.heightMin > HEIGHT_RANGE.min || filters.heightMax < HEIGHT_RANGE.max) {
    items.push({
      key: "height",
      label: `키 ${rangeLabel({ ...HEIGHT_RANGE, valueMin: filters.heightMin, valueMax: filters.heightMax, unit: "cm" })}`,
    });
  }
  for (const key of CHIP_KEYS) {
    const values = filters[key];
    if (values.length === 0) continue;
    const label =
      key === "tags"
        ? values.map(formatHashtag).join(" ")
        : values.map((v) => CHIP_LABELS[key][v] ?? v).join("·");
    items.push({ key, label });
  }
  return items;
}

/** 조건 하나를 지운다. 칩의 ✕ 가 부른다. */
export function clearFilter(filters: Filters, key: FilterSummaryItem["key"]): Filters {
  if (key === "age") return { ...filters, ageMin: AGE_RANGE.min, ageMax: AGE_RANGE.max };
  if (key === "height") {
    return { ...filters, heightMin: HEIGHT_RANGE.min, heightMax: HEIGHT_RANGE.max };
  }
  return { ...filters, [key]: [] };
}
