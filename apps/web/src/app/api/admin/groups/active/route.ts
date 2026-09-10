/**
 * PUT /api/admin/groups/active — 보고 있는 모임(채널) 전환
 *
 * `groupId: null` 은 전체공개다. 권한을 바꾸는 동작이 아니라 화면이 어느 모임을
 * 보여줄지와 새로 만드는 프로필·Import 가 어디로 들어갈지를 정한다.
 */
import { groupActivateSchema } from "@bolsaram/schemas";
import { requireAdmin } from "@/server/auth/guard";
import { setActiveGroup } from "@/server/auth/group-invite";
import { ok, readJson, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export const PUT = route(async (request: Request) => {
  const input = await readJson(request, groupActivateSchema);
  const viewer = await requireAdmin();
  await setActiveGroup(viewer.userId, input.groupId);
  return ok({ activeGroupId: input.groupId });
});
