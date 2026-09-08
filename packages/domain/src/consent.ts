/**
 * 등록 동의 판정 (마이그레이션 0019).
 *
 * 프로필은 주선자가 **남을 대신해** 등록한다. 그 사람이 볼사람을 모르는 채로 올라갈 수
 * 있고, 전체공개면 가입한 모든 주선자가 본다. 그래서 게시는 동의 기록을 전제로 한다.
 *
 * DB 는 「기록이 있는가」만 본다(`profiles_listed_requires_consent`). 이미 게시된 채로
 * 넘어온 프로필을 끌어내리면 돌고 있는 서비스가 멈추기 때문이다. **「실제로 확인한
 * 동의여야 한다」는 더 강한 요구는 여기서 건다** — 공개 범위를 새로 손대는 순간부터
 * 적용되므로, 기존 프로필도 다음에 건드릴 때 기록이 채워진다.
 */
import type { ConsentMethod, Visibility } from "@bolsaram/schemas";
import { DomainError } from "./errors";

/** 사람에게 실제로 확인한 방법. 나머지는 시스템이 붙인 표식이다. */
const CONFIRMED_METHODS: readonly ConsentMethod[] = ["KAKAO", "VERBAL", "WRITTEN"];

/** 회원에게 보이는 노출 단계. UNLISTED 도 링크를 받은 회원에게는 보인다. */
const MEMBER_VISIBLE: readonly Visibility[] = ["LISTED", "UNLISTED"];

export type ConsentState = {
  method: ConsentMethod | null;
  confirmedAt: Date | null;
};

/** 실제로 확인한 동의인가. SYNTHETIC(합성)·LEGACY(확인 필요)는 아니다. */
export function hasConfirmedConsent(consent: ConsentState): boolean {
  return consent.method !== null && CONFIRMED_METHODS.includes(consent.method);
}

/** 주선자가 손봐야 하는가 — 실제 사람인데 확인 기록이 없는 경우. */
export function needsConsentReview(consent: ConsentState): boolean {
  return consent.method === "LEGACY" || consent.method === null;
}

/**
 * 이 노출 단계로 바꿔도 되는가. 회원에게 보이게 만드는 전환만 막는다 —
 * 비공개로 내리는 것은 언제나 할 수 있어야 한다(문제를 발견했을 때 즉시 내려야 한다).
 */
export function assertConsentForVisibility(
  visibility: Visibility,
  consent: ConsentState,
): void {
  if (!MEMBER_VISIBLE.includes(visibility)) return;
  if (hasConfirmedConsent(consent)) return;

  throw new DomainError(
    "VALIDATION",
    consent.method === "SYNTHETIC"
      ? "합성 데이터는 공개할 수 없습니다."
      : "등록 동의를 먼저 기록해 주세요. 본인 확인 없이 공개할 수 없습니다.",
    { consentMethod: consent.method },
  );
}
