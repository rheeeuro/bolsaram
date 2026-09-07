import { inviteClaimSchema } from "@bolsaram/schemas";
import { claimInvite } from "@/server/auth/invite";
import { requireUser } from "@/server/auth/guard";
import { ok, readJson, route } from "@/server/http/respond";

export const POST = route(async (request: Request) => {
  const viewer = await requireUser();
  const input = await readJson(request, inviteClaimSchema);
  const result = await claimInvite({ token: input.token, userId: viewer.userId });
  return ok({ ok: true, profileId: result.profileId });
});
