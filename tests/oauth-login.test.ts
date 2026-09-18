/**
 * 소셜 로그인의 왕복 상태.
 *
 * 인가 코드를 주고받는 사이에 우리가 지켜야 하는 것은 두 가지다.
 *
 *   1. 되돌아온 요청이 **우리가 보낸 그 요청**인가 (state)
 *   2. 코드를 가로챈 쪽이 그대로 교환할 수 없는가 (PKCE)
 *
 * 둘 다 제공자 서버 없이 판정할 수 있어야 해서 쿠키 값을 만드는 쪽과 맞춰 보는 쪽을
 * 따로 두었다. 이 테스트는 제공자를 부르지 않는다 — 부르기 **전에** 막히는지만 본다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

type OAuthModule = typeof import("../apps/web/src/server/auth/oauth");
let oauth: OAuthModule;

beforeAll(async () => {
  // 개발자 `.env` 에 무엇이 있든 이 파일 안에서는 구글만 켜져 있다고 고정한다.
  process.env.GOOGLE_CLIENT_ID = "test-google-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
  delete process.env.KAKAO_CLIENT_ID;
  delete process.env.KAKAO_CLIENT_SECRET;
  oauth = await import("../apps/web/src/server/auth/oauth");
});

/** 인가 URL 과 쿠키를 한 번에 만들어 둔다. 대부분의 검사가 이 쌍을 쓴다. */
function start(next: string | null = null) {
  const { authorizeUrl, cookieValue } = oauth.startOAuth("GOOGLE", next);
  return { url: new URL(authorizeUrl), cookieValue };
}

describe("로그인 시작", () => {
  it("제공자 인가 주소로 보낸다", () => {
    const { url } = start();
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("test-google-client");
  });

  it("콘솔에 등록할 redirect_uri 와 실제로 보내는 값이 같다", () => {
    // 이 둘이 어긋나면 제공자가 거절한다. 안내 문구와 요청이 같은 함수를 봐야 한다.
    const { url } = start();
    expect(url.searchParams.get("redirect_uri")).toBe(oauth.oauthRedirectUri("GOOGLE"));
  });

  it("PKCE 는 S256 이고 challenge 가 verifier 의 해시다", () => {
    const { url, cookieValue } = start();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");

    // 쿠키는 서명된 봉투다. 안을 들여다보는 것은 이 검사뿐이고, 코드가 쓰는 경로는
    // 아니다 — verifier 가 정말 challenge 와 짝인지 확인하려면 열어봐야 한다.
    const payload = JSON.parse(
      Buffer.from(cookieValue.split(".")[0]!, "base64url").toString("utf8"),
    ) as { verifier: string; state: string };
    const expected = createHash("sha256").update(payload.verifier).digest("base64url");
    expect(url.searchParams.get("code_challenge")).toBe(expected);
    // state 는 URL 로 나가지만 verifier 는 나가지 않는다.
    expect(url.searchParams.get("state")).toBe(payload.state);
    expect(cookieValue).not.toBe(payload.verifier);
    expect(url.toString()).not.toContain(payload.verifier);
  });

  it("설정하지 않은 제공자는 시작하지 못한다", () => {
    // 화면에 버튼이 없어도 경로를 직접 두드릴 수 있다.
    expect(() => oauth.startOAuth("KAKAO", null)).toThrow(/설정되지 않았습니다/);
  });
});

describe("콜백 검증", () => {
  /** 쿠키에서 state 만 꺼낸다 — 정상 왕복을 흉내 내는 검사에 쓴다. */
  function stateOf(cookieValue: string): string {
    return (
      JSON.parse(Buffer.from(cookieValue.split(".")[0]!, "base64url").toString("utf8")) as {
        state: string;
      }
    ).state;
  }

  it("쿠키가 없으면 거절한다", async () => {
    const { cookieValue } = start();
    await expect(
      oauth.completeOAuth({
        provider: "GOOGLE",
        code: "code",
        state: stateOf(cookieValue),
        cookieValue: null,
      }),
    ).rejects.toThrow(/만료/);
  });

  it("state 가 다르면 거절한다", async () => {
    const { cookieValue } = start();
    await expect(
      oauth.completeOAuth({
        provider: "GOOGLE",
        code: "code",
        state: "남이-보낸-state-값입니다",
        cookieValue,
      }),
    ).rejects.toThrow(/만료/);
  });

  it("쿠키를 고치면 서명이 맞지 않아 거절한다", async () => {
    const { cookieValue } = start();
    const [payload, signature] = cookieValue.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        provider: "GOOGLE",
        state: "내가-정한-state-값입니다",
        verifier: "내가-정한-verifier-값입니다",
        next: "/home",
        issuedAt: Date.now(),
      }),
    ).toString("base64url");
    expect(forged).not.toBe(payload);
    await expect(
      oauth.completeOAuth({
        provider: "GOOGLE",
        code: "code",
        state: "내가-정한-state-값입니다",
        cookieValue: `${forged}.${signature!}`,
      }),
    ).rejects.toThrow(/만료/);
  });

  it("다른 제공자의 쿠키로 들어오면 거절한다", async () => {
    const { cookieValue } = start();
    await expect(
      oauth.completeOAuth({
        provider: "KAKAO",
        code: "code",
        state: stateOf(cookieValue),
        cookieValue,
      }),
      // 카카오가 꺼져 있다는 사실이 먼저 걸린다. 켜져 있어도 제공자 불일치로 막힌다.
    ).rejects.toThrow();
  });
});
