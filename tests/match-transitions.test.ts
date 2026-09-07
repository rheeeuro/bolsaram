/** MatchRequest 상태 기계 (부트스트랩 §12 「match transition」). */
import { describe, expect, it } from "vitest";
import {
  DomainError,
  allowedActions,
  assertCanCreateRequest,
  isActiveStatus,
  isTerminalStatus,
  resolveTransition,
} from "@bolsaram/domain";
import { MATCH_REQUEST_STATUSES, type MatchRequestStatus } from "@bolsaram/schemas";

describe("resolveTransition", () => {
  it("대상이 REQUESTED 를 수락하면 ACCEPTED 가 된다", () => {
    expect(
      resolveTransition({ action: "accept", current: "REQUESTED", actor: "target" }),
    ).toEqual({
      from: "REQUESTED",
      to: "ACCEPTED",
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

  it("수락 전에는 연결할 수 없다", () => {
    const error = catchError(() =>
      resolveTransition({ action: "introduce", current: "REQUESTED", actor: "admin" }),
    );
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe("INVALID_STATE");
  });

  it("연결은 관리자만 할 수 있다", () => {
    expect(() =>
      resolveTransition({ action: "introduce", current: "ACCEPTED", actor: "target" }),
    ).toThrowError(DomainError);
    expect(
      resolveTransition({ action: "introduce", current: "ACCEPTED", actor: "admin" }).to,
    ).toBe("INTRODUCED");
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
    const active: MatchRequestStatus[] = ["REQUESTED", "ACCEPTED", "INTRODUCED"];
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
    for (const status of ["REQUESTED", "ACCEPTED", "INTRODUCED"] as const) {
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

  it("종결된 신청이 있으면 다시 신청할 수 있다", () => {
    expect(() =>
      assertCanCreateRequest({
        requesterProfileId: "a",
        targetProfileId: "b",
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
