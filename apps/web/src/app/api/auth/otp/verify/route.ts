import { verifyOtpSchema } from "@bolsaram/schemas";
import { verifyLoginCode } from "@/server/auth/login";
import { createSession } from "@/server/auth/session";
import { ok, readJson, route } from "@/server/http/respond";

export const POST = route(async (request: Request) => {
  const input = await readJson(request, verifyOtpSchema);
  const userId = await verifyLoginCode(input.phone, input.code);
  await createSession(userId, request.headers.get("user-agent") ?? undefined);
  return ok({ ok: true });
});
