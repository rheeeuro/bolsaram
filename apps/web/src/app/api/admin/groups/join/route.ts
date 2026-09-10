/**
 * POST /api/admin/groups/join — 초대 코드로 모임 합류
 *
 * 이미 다른 모임에 속해 있어도 된다. 합류한 모임이 바로 보고 있는 채널이 된다.
 */
import { groupJoinSchema } from "@bolsaram/schemas";
import { requireAdmin } from "@/server/auth/guard";
import { consumeGroupInvite } from "@/server/auth/group-invite";
import { ok, readJson, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const input = await readJson(request, groupJoinSchema);
  const viewer = await requireAdmin();
  const joined = await consumeGroupInvite({ code: input.code, userId: viewer.userId });
  return ok(joined);
});
