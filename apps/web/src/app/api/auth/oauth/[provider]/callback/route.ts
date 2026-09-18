/**
 * GET /api/auth/oauth/:provider/callback — 제공자가 되돌려보내는 곳
 *
 * 여기서 세션이 생긴다. 가입과 로그인이 같은 경로다 — 처음 들어온 제공자 계정이면
 * 주선자 계정을 만들고, 이미 있으면 그 계정으로 들어간다.
 *
 * 되돌아오는 값은 전부 외부 입력이다. state·PKCE 검증은 `completeOAuth` 가 한다.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { oauthProviderSchema } from "@bolsaram/schemas";
import { OAUTH_COOKIE, completeOAuth, loginWithOAuth } from "@/server/auth/oauth";
import { createSession } from "@/server/auth/session";
import { env } from "@/server/env";
import { safeNextPath } from "@/lib/next-path";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const url = new URL(request.url);
  // 돌아갈 곳은 요청이 아니라 APP_ORIGIN 이 정한다. Cloudflare Tunnel 뒤에서는 요청의
  // host 가 loopback 이라, 요청에서 뽑으면 사용자를 localhost 로 보낸다.
  const origin = env().APP_ORIGIN;
  const back = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${reason}`, origin));

  // 성공하든 실패하든 왕복 상태는 한 번만 쓴다. 남겨두면 재생의 여지가 된다.
  const store = await cookies();
  const cookieValue = store.get(OAUTH_COOKIE)?.value ?? null;
  store.delete(OAUTH_COOKIE);

  // 사용자가 동의 화면에서 취소하면 code 없이 error 만 온다. 실패가 아니라 선택이다.
  if (url.searchParams.get("error")) return back("canceled");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back("canceled");

  try {
    const provider = oauthProviderSchema.parse((await params).provider);
    const { identity, next } = await completeOAuth({ provider, code, state, cookieValue });
    const userId = await loginWithOAuth(identity);
    await createSession(userId, request.headers.get("user-agent") ?? undefined);
    return NextResponse.redirect(new URL(safeNextPath(next) ?? "/home", origin));
  } catch (error) {
    // 신원·토큰은 남기지 않는다. 무엇이 실패했는지만 남긴다.
    console.error("소셜 로그인 콜백 실패", error);
    return back("failed");
  }
}
