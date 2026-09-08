/**
 * 인증 화면이 외부에서 받은 문자열을 다루는 두 지점.
 *
 *   입장코드 — 카카오톡에서 옮겨오다 링크·공백이 섞여 들어온다
 *   `?next=` — 로그인 뒤 돌아갈 경로. 열린 리다이렉터가 되면 안 된다
 *
 * 둘 다 화면 밖에서 판정할 수 있어야 해서 순수 함수로 두고 여기서 고정한다.
 */
import { describe, expect, it } from "vitest";
import { extractInviteCode } from "../apps/web/src/lib/invite-code";
import { safeNextPath } from "../apps/web/src/lib/next-path";

describe("입장코드 정규화", () => {
  it("코드만 넣으면 그대로 쓴다", () => {
    expect(extractInviteCode("abcDEF-123_xyz")).toBe("abcDEF-123_xyz");
  });

  it("앞뒤 공백을 지운다", () => {
    expect(extractInviteCode("  abcDEF  ")).toBe("abcDEF");
  });

  it("초대 링크 전체를 붙여넣어도 코드를 뽑는다", () => {
    expect(extractInviteCode("https://bolsaram.com/claim/abcDEF-123_xyz")).toBe(
      "abcDEF-123_xyz",
    );
  });

  it("링크 뒤의 쿼리·해시·슬래시를 잘라낸다", () => {
    expect(extractInviteCode("https://bolsaram.com/claim/abcDEF?utm=kakao")).toBe("abcDEF");
    expect(extractInviteCode("https://bolsaram.com/claim/abcDEF#top")).toBe("abcDEF");
    expect(extractInviteCode("https://bolsaram.com/claim/abcDEF/")).toBe("abcDEF");
  });

  it("인코딩된 코드를 되돌린다", () => {
    expect(extractInviteCode("https://bolsaram.com/claim/ab%2BcD")).toBe("ab+cD");
  });

  it("빈 값과 코드 없는 링크는 거절한다", () => {
    expect(extractInviteCode("")).toBeNull();
    expect(extractInviteCode("   ")).toBeNull();
    expect(extractInviteCode("https://bolsaram.com/claim/")).toBeNull();
  });
});

describe("로그인 뒤 돌아갈 경로", () => {
  it("같은 출처의 경로만 통과시킨다", () => {
    expect(safeNextPath("/discover")).toBe("/discover");
    expect(safeNextPath("/admin/profiles?status=INACTIVE")).toBe(
      "/admin/profiles?status=INACTIVE",
    );
  });

  it("다른 출처로 나가는 값을 막는다", () => {
    expect(safeNextPath("//evil.example.com")).toBeNull();
    expect(safeNextPath("/\\evil.example.com")).toBeNull();
    expect(safeNextPath("https://evil.example.com")).toBeNull();
    expect(safeNextPath("javascript:alert(1)")).toBeNull();
  });

  it("없으면 없다고 답한다", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
  });
});
