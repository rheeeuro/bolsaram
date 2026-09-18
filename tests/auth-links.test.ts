/**
 * 인증이 주소를 다루는 세 지점.
 *
 *   입장코드 — 카카오톡에서 옮겨오다 링크·공백이 섞여 들어온다
 *   `?next=` — 로그인 뒤 돌아갈 경로. 열린 리다이렉터가 되면 안 된다
 *   소셜 로그인 리다이렉트 — 돌아갈 곳은 요청이 아니라 `APP_ORIGIN` 이 정한다
 *
 * 앞의 둘은 순수 함수라 직접 부르고, 마지막은 라우트가 `next/headers` 를 쓰기 때문에
 * 소스에서 규약을 확인한다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
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
    expect(safeNextPath("/profiles?status=INACTIVE")).toBe("/profiles?status=INACTIVE");
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

/**
 * 인증 라우트가 사용자를 되돌려보내는 주소.
 *
 * Cloudflare Tunnel 뒤에서는 들어오는 요청의 host 가 loopback 이다. 그 값으로 절대
 * 주소를 만들면 로그인을 마친 사용자가 `localhost:3020` 으로 튕긴다 — 실측으로 겪었다.
 * 돌아갈 곳은 항상 `APP_ORIGIN` 이 정한다.
 *
 * 이 라우트들은 `next/headers` 를 쓰기 때문에 vitest 에서 실행할 수 없다. 그래서
 * 소스에서 규약을 확인한다.
 */
describe("소셜 로그인 리다이렉트 주소", () => {
  const ROUTES = [
    "apps/web/src/app/api/auth/oauth/[provider]/start/route.ts",
    "apps/web/src/app/api/auth/oauth/[provider]/callback/route.ts",
  ];

  for (const file of ROUTES) {
    it(`${file} 은 요청 host 로 절대 주소를 만들지 않는다`, () => {
      const source = readFileSync(
        path.join(path.resolve(import.meta.dirname, ".."), file),
        "utf8",
      );
      expect(source).not.toMatch(/new URL\([^)]*,\s*url\.origin\s*\)/);
      expect(source).toMatch(/APP_ORIGIN/);
    });
  }
});
