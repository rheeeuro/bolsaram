import { adminLoginSchema } from "@bolsaram/schemas";
import { loginAdmin } from "@/server/auth/login";
import { createSession } from "@/server/auth/session";
import { ok, readJson, route } from "@/server/http/respond";

export const POST = route(async (request: Request) => {
  const input = await readJson(request, adminLoginSchema);
  const userId = await loginAdmin(input.email, input.password);
  await createSession(userId, request.headers.get("user-agent") ?? undefined);
  return ok({ ok: true });
});
