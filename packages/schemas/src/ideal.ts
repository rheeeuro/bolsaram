/**
 * 이상형 조건 — 프로필의 이상형 글을 구조화한 값. 프로필 항목처럼 저장한다(`profiles.ideal_criteria`).
 *
 * 가져오기 때 AI 추출이 다른 항목과 **같은 호출에서** 함께 뽑고(`extraction.ts` 의
 * `idealCriteria`), 주선자가 검토·편집 화면에서 고친다. 추천은 저장된 값만 견주므로
 * 추천을 볼 때 AI 를 부르지 않는다.
 *
 * 추천은 이 조건을 상대 프로필의 항목과 견주는 것이라, **조건이 가리키는 값은 프로필
 * 항목과 같은 열거형**을 쓴다(지역·종교·흡연·음주·직업군). 성격·취미처럼 열거형이 없는
 * 것은 해시태그와 같은 형태의 키워드로 두고 상대의 해시태그·취미와 견준다.
 *
 * 규칙은 추출 스키마와 같다 — 글에 없는 조건은 지어내지 않고 비워 두며, 모델 출력은
 * 이 스키마로 검증한 뒤에만 쓴다.
 */
import { z } from "zod";
import { DRINKING_LEVELS, JOB_CATEGORIES, REGIONS, RELIGIONS, SMOKING_LEVELS } from "./enums";
import { HASHTAG_MAX_COUNT, normalizeHashtags, rawHashtagListSchema } from "./hashtag";

/** 조건 하나의 이름. 「꼭」이라고 적은 조건을 가리킬 때와 화면 라벨에 쓴다. */
export const IDEAL_CRITERION_KEYS = [
  "age",
  "height",
  "region",
  "religion",
  "smoking",
  "drinking",
  "job",
] as const;
export type IdealCriterionKey = (typeof IDEAL_CRITERION_KEYS)[number];

/**
 * 모델이 돌려주는 모양이자 DB 에 저장하는 모양. 추출 스키마에 그대로 들어가므로
 * transform 을 걸지 않는다(strict JSON Schema 를 이 정의에서 만든다).
 *
 * 숫자에 범위를 걸지 않는다 — 한 칸이 조금 벗어났다고 결과 전체를 버리면 아깝다.
 * 범위 밖 값은 `normalizeIdealCriteria` 가 그 칸만 비운다. 빈 배열은 「언급 없음」이다.
 */
export const idealCriteriaSchema = z.object({
  birthYearMin: z.number().int().nullable(),
  birthYearMax: z.number().int().nullable(),
  heightMin: z.number().int().nullable(),
  heightMax: z.number().int().nullable(),
  regions: z.array(z.enum(REGIONS)).max(REGIONS.length),
  religions: z.array(z.enum(RELIGIONS)).max(RELIGIONS.length),
  smoking: z.array(z.enum(SMOKING_LEVELS)).max(SMOKING_LEVELS.length),
  drinking: z.array(z.enum(DRINKING_LEVELS)).max(DRINKING_LEVELS.length),
  jobCategories: z.array(z.enum(JOB_CATEGORIES)).max(JOB_CATEGORIES.length),
  /** 성격·취미·생활 키워드. 해시태그와 같은 정규화를 거쳐 상대의 태그·취미와 맞춘다. */
  keywords: rawHashtagListSchema,
  /**
   * 피한다고 적은 것 가운데 열거형으로 옮길 수 없는 것(「문신 비선호」의 문신).
   * 상대의 태그·취미에 있으면 덜 맞는 것으로 본다. 이 칸이 생기기 전에 저장된 조건도
   * 읽히도록 기본값을 둔다 — strict JSON Schema 에서는 default 가 빠지고 필수가 된다.
   */
  avoidKeywords: rawHashtagListSchema.default([]),
  /** 글에서 「꼭」「필수」「절대」처럼 양보하지 않는다고 적은 조건. */
  required: z.array(z.enum(IDEAL_CRITERION_KEYS)).max(IDEAL_CRITERION_KEYS.length),
});
export type IdealCriteria = z.infer<typeof idealCriteriaSchema>;

const BIRTH_YEAR_FLOOR = 1940;
const BIRTH_YEAR_CEIL = 2015;
const HEIGHT_FLOOR = 130;
const HEIGHT_CEIL = 220;

function within(value: number | null, floor: number, ceil: number): number | null {
  return value != null && value >= floor && value <= ceil ? value : null;
}

/** 아래·위가 뒤집혀 오면 바로잡는다(「95~90년생」). */
function ordered(min: number | null, max: number | null): [number | null, number | null] {
  return min != null && max != null && min > max ? [max, min] : [min, max];
}

/**
 * 저장·비교 직전에 한 번 거는 정리. 범위 밖 숫자는 그 칸만 비우고, 키워드는 해시태그와
 * 같은 형태로 만들고, 조건이 없는데 「꼭」으로 표시된 것은 뺀다. 몇 번 걸어도 같다.
 */
export function normalizeIdealCriteria(raw: IdealCriteria): IdealCriteria {
  const [birthYearMin, birthYearMax] = ordered(
    within(raw.birthYearMin, BIRTH_YEAR_FLOOR, BIRTH_YEAR_CEIL),
    within(raw.birthYearMax, BIRTH_YEAR_FLOOR, BIRTH_YEAR_CEIL),
  );
  const [heightMin, heightMax] = ordered(
    within(raw.heightMin, HEIGHT_FLOOR, HEIGHT_CEIL),
    within(raw.heightMax, HEIGHT_FLOOR, HEIGHT_CEIL),
  );
  const unique = <T>(list: readonly T[]) => [...new Set(list)];
  const criteria: IdealCriteria = {
    birthYearMin,
    birthYearMax,
    heightMin,
    heightMax,
    regions: unique(raw.regions),
    religions: unique(raw.religions),
    smoking: unique(raw.smoking),
    drinking: unique(raw.drinking),
    jobCategories: unique(raw.jobCategories),
    keywords: [],
    avoidKeywords: normalizeHashtags(raw.avoidKeywords ?? []).slice(0, HASHTAG_MAX_COUNT),
    required: [],
  };
  // 바라는 것과 피하는 것에 같은 낱말이 있으면 피하는 쪽을 믿는다 — 반대로 두면 그런 사람을 추천한다.
  criteria.keywords = normalizeHashtags(raw.keywords)
    .filter((k) => !criteria.avoidKeywords.includes(k))
    .slice(0, HASHTAG_MAX_COUNT);
  criteria.required = unique(raw.required).filter((key) => idealCriterionStated(criteria, key));
  return criteria;
}

/** 이 조건이 글에 적혀 있었는가. */
export function idealCriterionStated(criteria: IdealCriteria, key: IdealCriterionKey): boolean {
  switch (key) {
    case "age":
      return criteria.birthYearMin != null || criteria.birthYearMax != null;
    case "height":
      return criteria.heightMin != null || criteria.heightMax != null;
    case "region":
      return criteria.regions.length > 0;
    case "religion":
      return criteria.religions.length > 0;
    case "smoking":
      return criteria.smoking.length > 0;
    case "drinking":
      return criteria.drinking.length > 0;
    case "job":
      return criteria.jobCategories.length > 0;
  }
}

/** 견줄 조건이 하나도 없으면 추천에 쓸 수 없다(「착한 사람」만 적힌 글 등). */
export function isIdealCriteriaEmpty(criteria: IdealCriteria): boolean {
  return (
    criteria.keywords.length === 0 &&
    criteria.avoidKeywords.length === 0 &&
    IDEAL_CRITERION_KEYS.every((key) => !idealCriterionStated(criteria, key))
  );
}

export function emptyIdealCriteria(): IdealCriteria {
  return {
    birthYearMin: null,
    birthYearMax: null,
    heightMin: null,
    heightMax: null,
    regions: [],
    religions: [],
    smoking: [],
    drinking: [],
    jobCategories: [],
    keywords: [],
    avoidKeywords: [],
    required: [],
  };
}
