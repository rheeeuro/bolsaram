/**
 * Discover 조건의 순수 모델. 화면과 떨어뜨려 테스트 가능하게 둔다.
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
};

const CHIP_KEYS = ["regions", "jobCategories", "religions", "smoking", "drinking"] as const;

/** 끝에서 벗어난 경계만 쿼리로 보낸다. 끝에 붙은 쪽은 절을 만들지 않는다. */
export function filtersToParams(filters: Filters, gender: string | null): URLSearchParams {
  const params = new URLSearchParams();
  if (gender) params.set("gender", gender);
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
