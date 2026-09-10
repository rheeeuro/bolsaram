/**
 * MatchRequest 상태 기계 (설계문서 §4, 부트스트랩 §6).
 * 모든 전이 판정은 여기에 중앙화한다. API/DB 레이어는 판정을 재구현하지 않는다.
 *
 *   REQUESTED ─accept──► INTRODUCED ─close──► CLOSED
 *       │
 *       ├─reject──► REJECTED
 *       └─cancel──► CANCELED
 *
 * 상대의 수락이 곧 연락처 공개 동의다. 그래서 수락은 바로 INTRODUCED 로 간다 —
 * 그 사이에 주선자 승인 단계를 두지 않는다.
 */
import {
  ACTIVE_MATCH_REQUEST_STATUSES,
  type MatchIntentKind,
  type MatchRequestStatus,
} from "@bolsaram/schemas";
import { DomainError } from "./errors";

export type MatchAction = "accept" | "reject" | "cancel" | "close";

/** 행위 주체. 상태뿐 아니라 누가 하는지도 전이 조건이다. */
export type MatchActor = "requester" | "target" | "admin";

type TransitionRule = {
  from: readonly MatchRequestStatus[];
  to: MatchRequestStatus;
  actors: readonly MatchActor[];
};

const TRANSITIONS: Record<MatchAction, TransitionRule> = {
  accept: { from: ["REQUESTED"], to: "INTRODUCED", actors: ["target", "admin"] },
  reject: { from: ["REQUESTED"], to: "REJECTED", actors: ["target", "admin"] },
  cancel: { from: ["REQUESTED"], to: "CANCELED", actors: ["requester", "admin"] },
  close: { from: ["INTRODUCED"], to: "CLOSED", actors: ["admin"] },
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

/**
 * 신청 생성 전 검사. 자기 자신/활성 중복은 금지(설계문서 §4).
 *
 * 거절과 숨김은 **방향을 구분하지 않는다**(마이그레이션 0023). 한쪽만 막으면
 * 거절한 사람이 같은 상대에게 새로 신청할 수 있어, 탐색 목록에서 서로 빠지는 것과
 * 어긋난다. 같은 판정을 DB 트리거가 한 번 더 한다.
 */
export function assertCanCreateRequest(input: {
  requesterProfileId: string;
  targetProfileId: string;
  existingActiveStatus?: MatchRequestStatus | null;
  /** 어느 방향이든 거절된 이력이 있는가. */
  rejectedBetween?: boolean;
  /** 어느 방향이든 숨긴 관계인가. */
  hiddenBetween?: boolean;
}): void {
  if (input.requesterProfileId === input.targetProfileId) {
    throw new DomainError("VALIDATION", "자기 자신에게는 신청할 수 없습니다.");
  }
  if (input.existingActiveStatus) {
    throw new DomainError("CONFLICT", "이미 진행 중인 신청이 있습니다.", {
      status: input.existingActiveStatus,
    });
  }
  // 거절과 숨김에 **같은 문구**를 쓴다. 문구가 갈리면 자기가 거절한 사실을 아는
  // 사람이 「거절」이 아닌 답을 받는 것만으로 상대가 숨겼음을 추론할 수 있다.
  // 왜 막혔는지는 가이드가 설명하고, 화면은 이유를 구분하지 않는다.
  if (input.hiddenBetween || input.rejectedBetween) {
    throw new DomainError("FORBIDDEN", CANNOT_REQUEST_MESSAGE);
  }
}

/** 거절·숨김에 공통으로 쓰는 문구. 두 이유를 구분하지 않는 것이 요점이다. */
export const CANNOT_REQUEST_MESSAGE = "지금은 이 분에게 마음을 보낼 수 없습니다.";

/**
 * 숨기기 전 검사 (마이그레이션 0024).
 *
 * 활성 신청이 있는 상대는 숨기지 못한다. 숨긴 뒤에 신청이 수락되면 **숨긴 사이인데
 * 연결된** 상태가 되고, 화면은 연결된 상대에게 숨김 해제를 주지 않으므로 회원이
 * 스스로 되돌릴 수 없다. 0023 이 반대 방향(숨긴 관계에는 신청 불가)을 막으므로,
 * 이 검사가 붙으면 순서에 상관없이 그 조합이 생기지 않는다.
 *
 * 그래서 숨기기는 거절을 대신하지 않는다 — 받은 신청은 먼저 거절하고, 보낸 신청은
 * 먼저 취소한다. 거절 자체가 재신청을 막으므로 두 흐름이 겹치지 않는다.
 */
export function assertCanHide(input: {
  hiderProfileId: string;
  hiddenProfileId: string;
  existingActiveStatus?: MatchRequestStatus | null;
}): void {
  if (input.hiderProfileId === input.hiddenProfileId) {
    throw new DomainError("VALIDATION", "자기 자신은 숨길 수 없습니다.");
  }
  if (input.existingActiveStatus === "INTRODUCED") {
    throw new DomainError(
      "CONFLICT",
      "이미 연결된 분은 숨길 수 없습니다. 주선자에게 알려주세요.",
    );
  }
  if (input.existingActiveStatus) {
    throw new DomainError(
      "CONFLICT",
      "진행 중인 신청이 있습니다. 먼저 신청을 거절하거나 취소해 주세요.",
      { status: input.existingActiveStatus },
    );
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

/**
 * 승인된 회원 요청이 무슨 전이를 뜻하는가 (마이그레이션 0026).
 *
 * `SEND` 만 전이가 아니다 — 그때는 옮길 신청이 아직 없고 새로 만든다.
 * 여기서 매핑만 하고 전이 가능 여부는 `resolveTransition` 이 그대로 판정한다.
 */
export function actionForIntent(kind: MatchIntentKind): MatchAction | null {
  switch (kind) {
    case "ACCEPT":
      return "accept";
    case "REJECT":
      return "reject";
    case "CANCEL":
      return "cancel";
    case "SEND":
      return null;
  }
}
