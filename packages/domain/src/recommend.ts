/**
 * AI 추천 — 한 사람의 이상형 조건을 다른 사람의 프로필 항목과 견준다.
 *
 * AI 는 이상형 글을 조건으로 바꾸는 데까지만 쓰고, **추천인지 아닌지는 여기서 규칙으로
 * 정한다.** 규칙은 하나다 — **확실한 조건을 모두 만족하면 추천이다.**
 *
 * - 확실한 조건: 나이·키·지역·종교·흡연·음주·직업군(`IDEAL_CRITERION_KEYS`). 프로필에
 *   같은 항목이 있어 맞다·아니다가 갈린다.
 * - 성격·취미 키워드와 피하는 낱말은 판정에 쓰지 않는다. 해시태그는 원문에 적힌 것만
 *   뽑아서, 겹치지 않는다고 그 성향이 없다는 뜻이 아니다.
 * - 상대 프로필에 그 항목이 비어 있으면(모름) 만족한 것으로 치지 않는다.
 *
 * 이 분의 이상형에 확실한 조건이 없으면 거꾸로 본다 — 상대가 적은 확실한 조건을 이 분이
 * 모두 만족하면 추천이다. 어느 쪽이든 상대가 「꼭」이라고 적은 조건에 이 분이 안 맞으면 뺀다.
 *
 * 이상형과 별개로 **공통점이 많은 사람**도 추천이다 — **같은 지역**(사는 곳·일하는 곳 중
 * 하나)이면서, 서로 겹치는 해시태그·취미와 같은 종교(무교 제외)가 `RECOMMEND_COMMON_MIN` 개
 * 이상이고, 양쪽 어느 조건과도 어긋나지 않고 피하는 낱말에 걸리지 않을 때다. 「담배 비선호」는 비흡연 조건으로 저장되므로, 조건과
 * 어긋나지 않아야 비선호도 함께 지켜진다(모름은 어긋난 것이 아니다).
 */
import {
  IDEAL_CRITERION_KEYS,
  idealCriterionStated,
  normalizeHashtag,
  type IdealCriteria,
  type IdealCriterionKey,
} from "@bolsaram/schemas";

/** 견주는 데 쓰는 프로필 항목. 이름·연락처는 받지 않는다. */
export type RecommendSubject = {
  id: string;
  gender: string;
  birthYear: number;
  height: number | null;
  residenceRegion: string;
  workplaceRegion: string | null;
  religion: string | null;
  smoking: string | null;
  drinking: string | null;
  jobCategory: string | null;
  hobbies: string[];
  hashtags: string[];
  /** 이상형 조건. 글이 없거나 아직 읽지 못했으면 null. */
  criteria: IdealCriteria | null;
};

/** 조건 하나를 견준 결과. 상대 항목이 비어 있으면 맞는지 알 수 없다(`unknown`). */
export type CriterionOutcome = "met" | "unmet" | "unknown";

export type CriterionCheck = {
  key: IdealCriterionKey;
  outcome: CriterionOutcome;
  /** 「꼭」이라고 적은 조건인가. */
  required: boolean;
};

export type DirectionResult = {
  /** 적힌 확실한 조건마다의 판정. 비어 있으면 견줄 조건이 없는 것이다. */
  checks: CriterionCheck[];
  /** 확실한 조건이 하나 이상 있고 모두 맞았다. 추천 판정이 보는 값이다. */
  meetsAll: boolean;
  /** 「꼭」 조건이 어긋났다(모름은 어긋난 것이 아니다). */
  blocked: boolean;
  /** 참고: 상대의 해시태그·취미 가운데 바라는 키워드와 겹친 것. 판정에는 쓰지 않는다. */
  keywordHits: string[];
  /** 참고: 상대의 해시태그·취미 가운데 피하는 낱말과 겹친 것. 판정에는 쓰지 않는다. */
  avoidHits: string[];
};

/** 두 사람의 공통점. 해시태그·취미는 정규화한 태그로, 종교는 열거형 값으로 싣는다. */
export type CommonPoints = {
  tags: string[];
  /** 둘 다 같은 종교일 때 그 값. 무교끼리는 공통점으로 세지 않는다. */
  religion: string | null;
};

/** 공통점이 많다고 부르는 개수. 운영 데이터에서 1개는 풀의 40% 가 넘어 「많다」가 아니다. */
export const RECOMMEND_COMMON_MIN = 2;

export type Recommendation = {
  candidateId: string;
  /** 이상형의 확실한 조건을 모두 만족해서 추천인가. 아니면 공통점으로 추천된 것이다. */
  idealMatch: boolean;
  common: CommonPoints;
  /** 이 분의 이상형 → 상대. 이 분에게 조건이 없으면 null. */
  forward: DirectionResult | null;
  /** 상대의 이상형 → 이 분. 상대에게 조건이 없으면 null. */
  reverse: DirectionResult | null;
  /** 양쪽 모두 확실한 조건이 있고, 서로 모두 만족한다. */
  mutual: boolean;
};

/** 키워드는 해시태그와 같은 형태로 맞춘다. 「운동」과 「운동매니아」처럼 한쪽이 다른 쪽을 품으면 겹친다고 본다. */
function keywordHits(keywords: string[], target: RecommendSubject): string[] {
  if (keywords.length === 0) return [];
  const pool = [...target.hashtags, ...target.hobbies]
    .map((tag) => normalizeHashtag(tag))
    .filter((tag): tag is string => tag != null);
  const hits: string[] = [];
  for (const tag of pool) {
    if (hits.includes(tag)) continue;
    if (keywords.some((k) => tag.includes(k) || k.includes(tag))) hits.push(tag);
  }
  return hits;
}

function inList(list: readonly string[], value: string | null): CriterionOutcome {
  if (value == null) return "unknown";
  return list.includes(value) ? "met" : "unmet";
}

function inRange(min: number | null, max: number | null, value: number | null): CriterionOutcome {
  if (value == null) return "unknown";
  if (min != null && value < min) return "unmet";
  if (max != null && value > max) return "unmet";
  return "met";
}

function outcomeFor(
  key: IdealCriterionKey,
  criteria: IdealCriteria,
  target: RecommendSubject,
): CriterionOutcome {
  switch (key) {
    case "age":
      return inRange(criteria.birthYearMin, criteria.birthYearMax, target.birthYear);
    case "height":
      return inRange(criteria.heightMin, criteria.heightMax, target.height);
    case "region": {
      // 사는 곳이나 일하는 곳 중 하나가 맞으면 만날 수 있는 거리다.
      const home = inList(criteria.regions, target.residenceRegion);
      const work = inList(criteria.regions, target.workplaceRegion);
      return home === "met" || work === "met" ? "met" : home;
    }
    case "religion":
      return inList(criteria.religions, target.religion);
    case "smoking":
      return inList(criteria.smoking, target.smoking);
    case "drinking":
      return inList(criteria.drinking, target.drinking);
    case "job":
      return inList(criteria.jobCategories, target.jobCategory);
  }
}

/** 한 사람의 이상형 조건을 상대 하나에 견준다. */
export function evaluateIdeal(criteria: IdealCriteria, target: RecommendSubject): DirectionResult {
  const checks: CriterionCheck[] = IDEAL_CRITERION_KEYS.filter((key) =>
    idealCriterionStated(criteria, key),
  ).map((key) => ({
    key,
    outcome: outcomeFor(key, criteria, target),
    required: criteria.required.includes(key),
  }));
  return {
    checks,
    meetsAll: checks.length > 0 && checks.every((c) => c.outcome === "met"),
    blocked: checks.some((c) => c.required && c.outcome === "unmet"),
    keywordHits: keywordHits(criteria.keywords, target),
    avoidHits: keywordHits(criteria.avoidKeywords, target),
  };
}

function tagsOf(person: RecommendSubject): string[] {
  return [
    ...new Set(
      [...person.hashtags, ...person.hobbies]
        .map((tag) => normalizeHashtag(tag))
        .filter((tag): tag is string => tag != null),
    ),
  ];
}

/** 두 사람의 공통점. 「등산」과 「주말등산」처럼 한쪽이 다른 쪽을 품으면 겹친다고 본다. */
export function commonPoints(a: RecommendSubject, b: RecommendSubject): CommonPoints {
  const theirs = tagsOf(b);
  return {
    tags: tagsOf(a).filter((tag) => theirs.some((t) => t.includes(tag) || tag.includes(t))),
    religion: a.religion && a.religion !== "NONE" && a.religion === b.religion ? a.religion : null,
  };
}

/**
 * 같은 지역인가 — 사는 곳·일하는 곳 중 하나라도 겹치면 만날 수 있는 거리다.
 * 공통점 추천의 전제이고, 개수로는 세지 않는다(풀 대부분이 같은 지역이라 세면 뜻이 없다).
 */
function sameArea(a: RecommendSubject, b: RecommendSubject): boolean {
  const areas = (p: RecommendSubject) =>
    [p.residenceRegion, p.workplaceRegion].filter((r): r is string => r != null);
  return areas(a).some((r) => areas(b).includes(r));
}

function commonCount(common: CommonPoints): number {
  return common.tags.length + (common.religion ? 1 : 0);
}

/** 그 사람이 적은 조건과 어긋나지 않고 피하는 낱말에도 걸리지 않는가. 조건이 없으면 걸릴 것이 없다. */
function noConflict(result: DirectionResult | null): boolean {
  return (
    result == null ||
    (result.avoidHits.length === 0 && result.checks.every((c) => c.outcome !== "unmet"))
  );
}

/** 확실한 조건이 하나라도 적혀 있는가. 키워드만 있는 이상형은 판정에 쓸 수 없다. */
function hasDefiniteCriteria(criteria: IdealCriteria | null): criteria is IdealCriteria {
  return criteria != null && IDEAL_CRITERION_KEYS.some((key) => idealCriterionStated(criteria, key));
}

/**
 * 후보들 가운데 이 분에게 추천인 사람을 고른다.
 *
 * 후보는 이미 「같은 쪽의 활성 이성」으로 좁혀서 넘긴다 — 여기서는 견주기만 한다.
 * 이 분에게 확실한 조건이 있으면 그것을 모두 만족하는 사람, 없으면 상대의 확실한 조건을
 * 이 분이 모두 만족하는 사람이다. 상대의 「꼭」 조건에 이 분이 안 맞으면 어느 쪽이든 뺀다.
 * 여기에 공통점이 많고 양쪽 조건·피하는 낱말에 걸리지 않는 사람을 더한다.
 * 순서는 서로 맞는 사람, 이상형으로 추천된 사람, 맞은 조건·공통점이 많은 사람 순이다.
 */
export function rankRecommendations(
  subject: RecommendSubject,
  candidates: RecommendSubject[],
): Recommendation[] {
  const own = hasDefiniteCriteria(subject.criteria) ? subject.criteria : null;

  const picked: (Recommendation & { metCount: number; commonCount: number })[] = [];
  for (const candidate of candidates) {
    if (candidate.id === subject.id) continue;
    const forward = own ? evaluateIdeal(own, candidate) : null;
    const reverse = hasDefiniteCriteria(candidate.criteria)
      ? evaluateIdeal(candidate.criteria, subject)
      : null;
    if (reverse?.blocked) continue;

    const decisive = own ? forward : reverse;
    const idealMatch = decisive?.meetsAll ?? false;
    const common = commonPoints(subject, candidate);
    const commonMatch =
      sameArea(subject, candidate) &&
      commonCount(common) >= RECOMMEND_COMMON_MIN &&
      noConflict(forward) &&
      noConflict(reverse);
    if (!idealMatch && !commonMatch) continue;

    picked.push({
      candidateId: candidate.id,
      idealMatch,
      common,
      forward,
      reverse,
      mutual: Boolean(forward?.meetsAll && reverse?.meetsAll),
      metCount: idealMatch && decisive ? decisive.checks.length : 0,
      commonCount: commonCount(common),
    });
  }

  picked.sort(
    (a, b) =>
      Number(b.mutual) - Number(a.mutual) ||
      Number(b.idealMatch) - Number(a.idealMatch) ||
      b.metCount - a.metCount ||
      b.commonCount - a.commonCount,
  );
  return picked.map(({ metCount: _m, commonCount: _c, ...rest }) => rest);
}
