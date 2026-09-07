/**
 * POST /api/claim — 초대 링크로 로그인 (매직 링크)
 *
 * **로그인을 요구하지 않는다.** 이 경로가 회원의 로그인 수단이다 — 토큰을 소비해
 * 계정을 확보하고 그 자리에서 세션을 만든다. 처음이면 회원 계정도 함께 만든다.
 *
 * 토큰이 곧 자격 증명이므로 실패 메시지에 존재 여부를 구분해 담지 않는다.
 */
import { inviteClaimSchema } from "@bolsaram/schemas";
import { consumeInvite } from "@/server/auth/invite";
import { createSession } from "@/server/auth/session";
import { ok, readJson, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const input = await readJson(request, inviteClaimSchema);
  const result = await consumeInvite({ token: input.token });
  await createSession(result.userId, request.headers.get("user-agent") ?? undefined);
  return ok({ ok: true, profileId: result.profileId, firstTime: result.firstTime });
});
