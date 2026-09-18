/**
 * GET /api/auth/oauth/:provider/start — 주선자 로그인 시작
 *
 * 브라우저가 직접 여는 주소라 JSON 이 아니라 리다이렉트로 답한다. 실패도 마찬가지로
 * 로그인 화면으로 돌려보내고 이유만 쿼리로 남긴다 — 사용자가 빈 JSON 을 보게 두지 않는다.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { oauthProviderSchema } from "@bolsaram/schemas";
import { OAUTH_COOKIE, OAUTH_STATE_TTL_MS, startOAuth } from "@/server/auth/oauth";
import { isProduction } from "@/server/env";
import { safeNextPath } from "@/lib/next-path";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const url = new URL(request.url);
  try {
    const provider = oauthProviderSchema.parse((await params).provider);
    const next = safeNextPath(url.searchParams.get("next"));
    const { authorizeUrl, cookieValue } = startOAuth(provider, next);

    const store = await cookies();
    store.set(OAUTH_COOKIE, cookieValue, {
      httpOnly: true,
      // 제공자에서 우리 주소로 되돌아오는 이동이 top-level GET 이라 lax 로 살아남는다.
      sameSite: "lax",
      secure: isProduction(),
      path: "/",
      maxAge: OAUTH_STATE_TTL_MS / 1000,
    });
    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    console.error("소셜 로그인 시작 실패", error);
    return NextResponse.redirect(new URL("/login?error=start", url.origin));
  }
}
