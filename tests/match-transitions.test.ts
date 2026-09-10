/** MatchRequest 상태 기계 (부트스트랩 §12 「match transition」). */
import { describe, expect, it } from "vitest";
import {
  CANNOT_REQUEST_MESSAGE,
  DomainError,
  allowedActions,
  assertCanCreateRequest,
  assertCanHide,
  isActiveStatus,
  isTerminalStatus,
  actionForIntent,
  resolveTransition,
} from "@bolsaram/domain";
import { MATCH_REQUEST_STATUSES, type MatchRequestStatus } from "@bolsaram/schemas";

describe("resolveTransition", () => {
  it("대상이 수락하면 곧바로 INTRODUCED 가 된다 — 주선자 승인 단계가 없다", () => {
    expect(
      resolveTransition({ action: "accept", current: "REQUESTED", actor: "target" }),
    ).toEqual({
      from: "REQUESTED",
      to: "INTRODUCED",
    });
  });

  it("신청자는 자기 신청을 수락할 수 없다", () => {
    expect(() =>
      resolveTransition({ action: "accept", current: "REQUESTED", actor: "requester" }),
    ).toThrowError(DomainError);
  });

  it("대상은 신청을 취소할 수 없다 — 취소는 신청자의 몫이다", () => {
    expect(() =>
      resolveTransition({ action: "cancel", current: "REQUESTED", actor: "target" }),
    ).toThrowError(/수행할 수 없는/);
  });

  it("연결 전에는 종료할 수 없다", () => {
    const error = catchError(() =>
      resolveTransition({ action: "close", current: "REQUESTED", actor: "admin" }),
    );
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe("INVALID_STATE");
  });

  it("종료는 관리자만 할 수 있다", () => {
    for (const actor of ["requester", "target"] as const) {
      expect(() =>
        resolveTransition({ action: "close", current: "INTRODUCED", actor }),
      ).toThrowError(DomainError);
    }
    expect(
      resolveTransition({ action: "close", current: "INTRODUCED", actor: "admin" }).to,
    ).toBe("CLOSED");
  });

  it("종결 상태에서는 어떤 전이도 불가능하다", () => {
    for (const status of ["REJECTED", "CANCELED", "CLOSED"] as const) {
      expect(isTerminalStatus(status)).toBe(true);
      for (const actor of ["requester", "target", "admin"] as const) {
        expect(allowedActions(status, actor)).toEqual([]);
      }
    }
  });

  it("모든 상태·행위자 조합에서 예외 없이 판정된다", () => {
    for (const status of MATCH_REQUEST_STATUSES) {
      for (const actor of ["requester", "target", "admin"] as const) {
        for (const action of allowedActions(status, actor)) {
          const result = resolveTransition({ action, current: status, actor });
          expect(MATCH_REQUEST_STATUSES).toContain(result.to);
          expect(result.to).not.toBe(status);
        }
      }
    }
  });

  it("활성 상태 판정", () => {
    const active: MatchRequestStatus[] = ["REQUESTED", "INTRODUCED"];
    for (const status of MATCH_REQUEST_STATUSES) {
      expect(isActiveStatus(status)).toBe(active.includes(status));
    }
  });
});

describe("assertCanCreateRequest", () => {
  it("자기 자신에게는 신청할 수 없다", () => {
    expect(() =>
      assertCanCreateRequest({ requesterProfileId: "a", targetProfileId: "a" }),
    ).toThrowError(/자기 자신/);
  });

  it("활성 신청이 있으면 중복 신청을 막는다", () => {
    for (const status of ["REQUESTED", "INTRODUCED"] as const) {
      const error = catchError(() =>
        assertCanCreateRequest({
          requesterProfileId: "a",
          targetProfileId: "b",
          existingActiveStatus: status,
        }),
      );
      expect((error as DomainError).code).toBe("CONFLICT");
    }
  });

  it("취소·종료로 끝난 뒤에는 다시 신청할 수 있다", () => {
    expect(() =>
      assertCanCreateRequest({
        requesterProfileId: "a",
        targetProfileId: "b",
        existingActiveStatus: null,
      }),
    ).not.toThrow();
  });

  it("거절된 관계에는 다시 신청할 수 없다", () => {
    const error = catchError(() =>
      assertCanCreateRequest({
        requesterProfileId: "a",
        targetProfileId: "b",
        rejectedBetween: true,
      }),
    );
    expect((error as DomainError).code).toBe("FORBIDDEN");
  });

  it("숨긴 관계에는 신청할 수 없다", () => {
    const error = catchError(() =>
      assertCanCreateRequest({
        requesterProfileId: "a",
        targetProfileId: "b",
        hiddenBetween: true,
      }),
    );
    expect((error as DomainError).code).toBe("FORBIDDEN");
  });

  /**
   * 이 테스트가 지키는 성질: **막힌 이유를 알려주지 않는다.**
   *
   * 문구가 갈리면 자기가 거절한 사실을 아는 사람이 「거절」이 아닌 답을 받는 것만으로
   * 상대가 자기를 숨겼음을 추론할 수 있다. 세 경우가 글자까지 같아야 한다.
   */
  it("거절·숨김·둘 다에 같은 문구를 쓴다 — 이유를 구분할 수 없다", () => {
    const messageFor = (relation: { rejectedBetween?: boolean; hiddenBetween?: boolean }) =>
      (
        catchError(() =>
          assertCanCreateRequest({
            requesterProfileId: "a",
            targetProfileId: "b",
            ...relation,
          }),
        ) as DomainError
      ).message;

    const messages = [
      messageFor({ rejectedBetween: true }),
      messageFor({ hiddenBetween: true }),
      messageFor({ rejectedBetween: true, hiddenBetween: true }),
    ];
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toBe(CANNOT_REQUEST_MESSAGE);
    // 이유를 드러내는 낱말이 들어가면 위 성질이 깨진다.
    expect(messages[0]).not.toMatch(/거절|숨/);
  });
});

describe("assertCanHide", () => {
  it("자기 자신은 숨길 수 없다", () => {
    expect(() => assertCanHide({ hiderProfileId: "a", hiddenProfileId: "a" })).toThrowError(
      /자기 자신/,
    );
  });

  /**
   * 숨긴 뒤 신청이 수락되면 「숨긴 사이인데 연결된」 상태가 되고, 화면이 연결된
   * 상대에게 해제를 주지 않아 되돌릴 수 없다. 그래서 활성 신청이 있으면 막는다.
   */
  it("진행 중인 신청이 있으면 숨길 수 없다", () => {
    for (const status of ["REQUESTED", "INTRODUCED"] as const) {
      const error = catchError(() =>
        assertCanHide({
          hiderProfileId: "a",
          hiddenProfileId: "b",
          existingActiveStatus: status,
        }),
      );
      expect((error as DomainError).code).toBe("CONFLICT");
    }
  });

  it("연결된 상대는 주선자에게 알리라고 안내한다", () => {
    const error = catchError(() =>
      assertCanHide({
        hiderProfileId: "a",
        hiddenProfileId: "b",
        existingActiveStatus: "INTRODUCED",
      }),
    );
    expect((error as DomainError).message).toMatch(/주선자/);
  });

  it("신청이 정리된 뒤에는 숨길 수 있다", () => {
    expect(() =>
      assertCanHide({
        hiderProfileId: "a",
        hiddenProfileId: "b",
        existingActiveStatus: null,
      }),
    ).not.toThrow();
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

describe("회원 요청 → 전이 매핑 (0026)", () => {
  it("SEND 는 전이가 아니다 — 승인 시 신청을 새로 만든다", () => {
    expect(actionForIntent("SEND")).toBeNull();
  });

  it("나머지 요청은 같은 이름의 전이로 간다", () => {
    expect(actionForIntent("ACCEPT")).toBe("accept");
    expect(actionForIntent("REJECT")).toBe("reject");
    expect(actionForIntent("CANCEL")).toBe("cancel");
  });

  it("승인은 요청을 낸 회원의 자격으로 판정된다 — 주선자 자격이 아니다", () => {
    // 받은 쪽이 낸 수락 요청. 주선자는 그 답을 옮길 뿐이라 actor 는 target 이다.
    expect(
      resolveTransition({ action: "accept", current: "REQUESTED", actor: "target" }).to,
    ).toBe("INTRODUCED");
    // 신청자 자격으로는 같은 전이를 할 수 없다.
    expect(() =>
      resolveTransition({ action: "accept", current: "REQUESTED", actor: "requester" }),
    ).toThrow();
  });
});
