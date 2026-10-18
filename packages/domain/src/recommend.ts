/**
 * 이상형 추천 — 한 사람의 이상형 조건을 다른 사람의 프로필 항목과 견준다.
 *
 * AI 는 이상형 글을 조건으로 바꾸는 데까지만 쓰고, **견주고 순위를 매기는 것은 여기서
 * 규칙으로 한다.** 그래야 같은 입력에 늘 같은 순서가 나오고, 화면이 「왜 이 사람인가」를
 * 조건 하나하나로 설명할 수 있다. 상대 프로필을 모델에 보내지도 않는다.
 *
 * 양쪽을 본다 — 이 분의 이상형에 상대가 맞는가(정방향)와 상대의 이상형에 이 분이
 * 맞는가(역방향). 한쪽에만 이상형 글이 있어도 그 방향으로 추천한다.
 */
import {
  IDEAL_CRITERION_KEYS,
  idealCriterionStated,
  isIdealCriteriaEmpty,
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
  /** 「꼭」이라고 적은 조건인가. 이것이 어긋나면 추천에서 뺀다. */
  required: boolean;
};

export type DirectionResult = {
  checks: CriterionCheck[];
  /** 상대의 해시태그·취미 가운데 이상형 키워드와 겹친 것. */
  keywordHits: string[];
  /** 상대의 해시태그·취미 가운데 피한다고 적은 낱말과 겹친 것. */
  avoidHits: string[];
  /** 0..1. 견줄 조건이 없으면 null. */
  score: number | null;
  /** 「꼭」 조건이 어긋났다. */
  blocked: boolean;
};

export type Recommendation = {
  candidateId: string;
  /** 이 분의 이상형 → 상대. 이 분에게 조건이 없으면 null. */
  forward: DirectionResult | null;
  /** 상대의 이상형 → 이 분. 상대에게 조건이 없으면 null. */
  reverse: DirectionResult | null;
  score: number;
  /** 양쪽 모두 조건이 있고, 어긋난 조건 없이 잘 맞는다. */
  mutual: boolean;
};

/**
 * 추천으로 치는 최소 점수. 멤버 탐색에 「AI 추천」으로 보이는 기준이다.
 * 「모름」(0.5)만으로는 넘지 못하고 실제로 맞는 조건이 있어야 한다 — 기준을 낮추면 같은
 * 풀의 대부분에 표시가 붙어 표시가 뜻을 잃는다(운영 데이터에서 0.5 는 풀의 2/3).
 */
export const RECOMMEND_MIN_SCORE = 0.75;
/** 서로 맞는다고 부르는 기준. 양쪽 모두 이 점수 이상이고 어긋난 조건이 없어야 한다. */
export const RECOMMEND_MUTUAL_SCORE = 0.75;

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

const OUTCOME_WEIGHT: Record<CriterionOutcome, number> = { met: 1, unknown: 0.5, unmet: 0 };

/**
 * 조건 하나를 상대에게 견준다.
 *
 * 점수는 적힌 조건의 평균이다 — 맞으면 1, 모르면 0.5, 어긋나면 0. 키워드는 가산점으로만
 * 쓴다: 겹치면 맞은 조건 하나로 치고, 안 겹치면 세지 않는다. 해시태그는 원문에 적힌
 * 것만 뽑으므로 없다고 해서 그 성향이 없다는 뜻이 아니다. 피하는 낱말은 그 반대다 —
 * 겹치면 어긋난 조건 하나로 치고, 안 겹치면 세지 않는다. 막지는 않는다(「꼭」이 아니다).
 */
export function evaluateIdeal(criteria: IdealCriteria, target: RecommendSubject): DirectionResult {
  const checks: CriterionCheck[] = IDEAL_CRITERION_KEYS.filter((key) =>
    idealCriterionStated(criteria, key),
  ).map((key) => ({
    key,
    outcome: outcomeFor(key, criteria, target),
    required: criteria.required.includes(key),
  }));
  const hits = keywordHits(criteria.keywords, target);
  const avoidHits = keywordHits(criteria.avoidKeywords, target);

  const weights = checks.map((c) => OUTCOME_WEIGHT[c.outcome]);
  if (hits.length > 0) weights.push(1);
  if (avoidHits.length > 0) weights.push(0);
  const score = weights.length > 0 ? weights.reduce((a, b) => a + b, 0) / weights.length : null;

  return {
    checks,
    keywordHits: hits,
    avoidHits,
    score,
    blocked: checks.some((c) => c.required && c.outcome === "unmet"),
  };
}

function usable(criteria: IdealCriteria | null): criteria is IdealCriteria {
  return criteria != null && !isIdealCriteriaEmpty(criteria);
}

/**
 * 후보들 가운데 이 분과 맞는 사람을 고른다.
 *
 * 후보는 이미 「같은 쪽의 활성 이성」으로 좁혀서 넘긴다 — 여기서는 견주기만 한다.
 * 「꼭」 조건이 어느 쪽에서든 어긋나면 뺀다. 넣을지는 이 분 기준 점수(없으면 상대 기준)로
 * 정하고, 순위는 있는 쪽 점수의 평균이다. 같으면 맞은 조건이 많은 쪽이 앞이다.
 */
export function rankRecommendations(
  subject: RecommendSubject,
  candidates: RecommendSubject[],
  options: { limit?: number; minScore?: number } = {},
): Recommendation[] {
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const minScore = options.minScore ?? RECOMMEND_MIN_SCORE;
  const own = usable(subject.criteria) ? subject.criteria : null;

  const ranked: (Recommendation & { metCount: number })[] = [];
  for (const candidate of candidates) {
    if (candidate.id === subject.id) continue;
    const forward = own ? evaluateIdeal(own, candidate) : null;
    const reverse = usable(candidate.criteria) ? evaluateIdeal(candidate.criteria, subject) : null;
    if (forward?.blocked || reverse?.blocked) continue;

    // 들어갈지는 이 분의 이상형으로 정한다(없으면 상대의 이상형). 역방향이 어긋난다고
    // 이 분에게 잘 맞는 사람을 감추면, 주선자는 「상대는 연상을 원함」 같은 사정을 보고
    // 판단할 기회를 잃는다. 역방향은 순서와 화면 표시에만 쓴다.
    const primary = forward?.score ?? reverse?.score ?? null;
    if (primary == null || primary < minScore) continue;
    const scores = [forward?.score, reverse?.score].filter((s): s is number => s != null);
    const score = scores.reduce((a, b) => a + b, 0) / scores.length;

    const noUnmet = (d: DirectionResult | null) =>
      d != null && d.avoidHits.length === 0 && d.checks.every((c) => c.outcome !== "unmet");
    const mutual =
      forward?.score != null &&
      reverse?.score != null &&
      forward.score >= RECOMMEND_MUTUAL_SCORE &&
      reverse.score >= RECOMMEND_MUTUAL_SCORE &&
      noUnmet(forward) &&
      noUnmet(reverse);

    const metCount = [forward, reverse].reduce(
      (n, d) => n + (d ? d.checks.filter((c) => c.outcome === "met").length + d.keywordHits.length : 0),
      0,
    );
    ranked.push({ candidateId: candidate.id, forward, reverse, score, mutual, metCount });
  }

  ranked.sort((a, b) => b.score - a.score || b.metCount - a.metCount);
  return ranked.slice(0, limit).map(({ metCount: _metCount, ...rest }) => rest);
}
