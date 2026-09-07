/**
 * 디자인 토큰의 TS 미러. CSS 가 원본이고, 여기에는 코드에서 참조해야 하는 값만 둔다.
 * 색을 새로 만들 때는 theme.css 를 먼저 고친다.
 */

export const BRAND = {
  nameKo: "볼사람",
  nameEn: "Bolsaram",
  tagline: "좋은 사람을, 좋은 방식으로.",
  subTagline: "지인의 소개가 더 좋은 인연이 될 수 있도록.",
  kicker: "PRIVATE MATCHING CLUB",
} as const;

/** 감정 연출 구간의 모션 길이(ms). CSS 변수와 값을 맞춘다. */
export const DURATION = {
  quick: 140,
  base: 240,
  emotive: 520,
} as const;

/** Discover 카드 이미지 비율. 리스트/상세에서 동일하게 유지한다. */
export const CARD_ASPECT_RATIO = 3 / 4;
