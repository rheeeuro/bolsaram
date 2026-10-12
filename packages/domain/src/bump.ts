/**
 * 프로필 끌어올리기 (마이그레이션 0062).
 *
 * 등록한 주선자가 맡은 분을 목록 맨 앞으로 다시 올린다. 누가 할 수 있는지는
 * `app_can_edit_profile` 이 정하고, 여기서는 **지금 할 수 있는 상태인가**만 판정한다.
 */
import type { ProfileStatus } from "@bolsaram/schemas";
import { DomainError } from "./errors";

/**
 * 프로필 하나를 다시 끌어올리기까지 기다리는 시간. DB 트리거(`app_profile_bump_guard`)가
 * 같은 값을 쓴다 — 한쪽만 바꾸면 화면이 허락한 끌어올리기를 DB 가 거절한다.
 */
export const PROFILE_BUMP_COOLDOWN_HOURS = 24;

const COOLDOWN_MS = PROFILE_BUMP_COOLDOWN_HOURS * 60 * 60 * 1000;

/** 다음에 끌어올릴 수 있는 시각. 한 번도 안 했으면 null(지금 바로). */
export function nextBumpAt(bumpedAt: Date | null): Date | null {
  return bumpedAt ? new Date(bumpedAt.getTime() + COOLDOWN_MS) : null;
}

/**
 * 끌어올릴 수 없는 이유. 할 수 있으면 null.
 *
 * 비활성 프로필은 멤버 목록에 없으므로 올려도 보이는 곳이 없다 — 채팅방에 알림만 남는다.
 */
export function bumpBlockedReason(
  profile: { status: ProfileStatus; bumpedAt: Date | null },
  now: Date,
): string | null {
  if (profile.status !== "ACTIVE") {
    return "활성 프로필만 끌어올릴 수 있습니다.";
  }
  const next = nextBumpAt(profile.bumpedAt);
  if (next && next.getTime() > now.getTime()) {
    return `끌어올리기는 ${PROFILE_BUMP_COOLDOWN_HOURS}시간에 한 번입니다.`;
  }
  return null;
}

export function assertBumpable(
  profile: { status: ProfileStatus; bumpedAt: Date | null },
  now: Date,
): void {
  const reason = bumpBlockedReason(profile, now);
  if (reason) throw new DomainError("CONFLICT", reason);
}
