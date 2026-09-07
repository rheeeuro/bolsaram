import { destroySession } from "@/server/auth/session";
import { ok, route } from "@/server/http/respond";

export const POST = route(async () => {
  await destroySession();
  return ok({ ok: true });
});
