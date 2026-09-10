/**
 * 내 모임들.
 *
 *   GET   속한 모임 전부 + 지금 보고 있는 채널
 *   POST  모임 만들기 (몇 개든 만들 수 있다)
 */
import { groupCreateSchema } from "@bolsaram/schemas";
import { requireAdmin } from "@/server/auth/guard";
import { readMyGroups } from "@/server/auth/group-invite";
import { createGroupForAdmin } from "@/server/auth/signup";
import { ok, readJson, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const viewer = await requireAdmin();
  const groups = await readMyGroups(viewer.userId);
  return ok({ groups, activeGroupId: viewer.groupId });
});

export const POST = route(async (request: Request) => {
  const input = await readJson(request, groupCreateSchema);
  const viewer = await requireAdmin();
  const created = await createGroupForAdmin({ userId: viewer.userId, ...input });
  return ok(created, { status: 201 });
});
