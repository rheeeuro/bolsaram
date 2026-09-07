/**
 * MatchRequest 상태 기계 (설계문서 §4, 부트스트랩 §6).
 * 모든 전이 판정은 여기에 중앙화한다. API/DB 레이어는 판정을 재구현하지 않는다.
 *
 *   REQUESTED ─accept──► ACCEPTED ─introduce──► INTRODUCED ─close──► CLOSED
 *       │                    │
 *       ├─reject──► REJECTED │
 *       └─cancel──► CANCELED └─close──► CLOSED
 */
import { ACTIVE_MATCH_REQUEST_STATUSES, type MatchRequestStatus } from "@bolsaram/schemas";
import { DomainError } from "./errors";

export type MatchAction = "accept" | "reject" | "cancel" | "introduce" | "close";

/** 행위 주체. 상태뿐 아니라 누가 하는지도 전이 조건이다. */
export type MatchActor = "requester" | "target" | "admin";

type TransitionRule = {
  from: readonly MatchRequestStatus[];
  to: MatchRequestStatus;
  actors: readonly MatchActor[];
};

const TRANSITIONS: Record<MatchAction, TransitionRule> = {
  accept: { from: ["REQUESTED"], to: "ACCEPTED", actors: ["target", "admin"] },
  reject: { from: ["REQUESTED"], to: "REJECTED", actors: ["target", "admin"] },
  cancel: { from: ["REQUESTED"], to: "CANCELED", actors: ["requester", "admin"] },
  introduce: { from: ["ACCEPTED"], to: "INTRODUCED", actors: ["admin"] },
  close: { from: ["ACCEPTED", "INTRODUCED"], to: "CLOSED", actors: ["admin"] },
};

export const TERMINAL_STATUSES: readonly MatchRequestStatus[] = [
  "REJECTED",
  "CANCELED",
  "CLOSED",
];

export function isActiveStatus(status: MatchRequestStatus): boolean {
  return (ACTIVE_MATCH_REQUEST_STATUSES as readonly string[]).includes(status);
}

export function isTerminalStatus(status: MatchRequestStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function allowedActions(status: MatchRequestStatus, actor: MatchActor): MatchAction[] {
  return (Object.keys(TRANSITIONS) as MatchAction[]).filter((action) => {
    const rule = TRANSITIONS[action];
    return rule.from.includes(status) && rule.actors.includes(actor);
  });
}

/**
 * 전이를 계산한다. 불가능하면 DomainError 를 던진다 — 조용히 무시하지 않는다.
 * 호출부는 이 결과의 `to` 를 조건부 UPDATE(`WHERE status = from`)에 써서
 * race condition 을 DB 레벨에서 한 번 더 막는다.
 */
export function resolveTransition(input: {
  action: MatchAction;
  current: MatchRequestStatus;
  actor: MatchActor;
}): { from: MatchRequestStatus; to: MatchRequestStatus } {
  const rule = TRANSITIONS[input.action];
  if (!rule) {
    throw new DomainError("VALIDATION", `알 수 없는 동작입니다: ${input.action}`);
  }
  if (!rule.actors.includes(input.actor)) {
    throw new DomainError("FORBIDDEN", "이 신청에 대해 수행할 수 없는 동작입니다.", {
      action: input.action,
      actor: input.actor,
    });
  }
  if (!rule.from.includes(input.current)) {
    throw new DomainError(
      "INVALID_STATE",
      `현재 상태(${input.current})에서는 ${input.action} 할 수 없습니다.`,
      { action: input.action, current: input.current, expected: rule.from },
    );
  }
  return { from: input.current, to: rule.to };
}

/** 신청 생성 전 검사. 자기 자신/활성 중복은 금지(설계문서 §4). */
export function assertCanCreateRequest(input: {
  requesterProfileId: string;
  targetProfileId: string;
  existingActiveStatus?: MatchRequestStatus | null;
}): void {
  if (input.requesterProfileId === input.targetProfileId) {
    throw new DomainError("VALIDATION", "자기 자신에게는 신청할 수 없습니다.");
  }
  if (input.existingActiveStatus) {
    throw new DomainError("CONFLICT", "이미 진행 중인 신청이 있습니다.", {
      status: input.existingActiveStatus,
    });
  }
}

/** 상대가 나에게 보낸 활성 신청이 있으면 그쪽을 수락하도록 안내한다. */
export function describeReciprocalHint(
  reverseStatus: MatchRequestStatus | null,
): string | null {
  if (reverseStatus === "REQUESTED") {
    return "상대가 먼저 마음을 보냈습니다. 받은 시그널에서 수락해 주세요.";
  }
  return null;
}
