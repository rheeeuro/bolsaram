/**
 * POST /api/auth/signup — 주선자 가입
 *
 * 가입은 열려 있지만 **가입만으로는 아무 데이터도 볼 수 없다.** 새 모임이 비어 있고,
 * RLS 가 `app_is_group_admin(group_id)` 로 판정하기 때문이다(db/migrations/0010).
 * 가입 직후 바로 세션을 만들어 관리자 화면으로 들어가게 한다.
 */
import { adminSignupSchema } from "@bolsaram/schemas";
import { createSession } from "@/server/auth/session";
import { signupAdmin } from "@/server/auth/signup";
import { ok, readJson, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const input = await readJson(request, adminSignupSchema);
  const created = await signupAdmin(input);
  await createSession(created.userId, request.headers.get("user-agent") ?? undefined);
  return ok({ ok: true }, { status: 201 });
});
