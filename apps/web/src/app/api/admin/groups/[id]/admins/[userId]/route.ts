/**
 * 모임의 주선자 한 명.
 *
 *   PATCH  모임장 넘기기 ({ isOwner: true })
 *   DELETE 모임에서 내보내기
 *
 * 둘 다 **모임장만** 한다. 소속을 바꾸는 동작이라 RLS 가 아예 열려 있지 않고
 * (`group_admins` 는 SELECT 정책 하나뿐) owner 커넥션으로 돈다 — `requireGroupOwner`
 * 가 유일한 판정이다.
 */
import { groupAdminUpdateSchema } from "@bolsaram/schemas";
import { requireGroupOwner } from "@/server/auth/guard";
import { removeGroupAdmin, transferGroupOwnership } from "@/server/auth/group-invite";
import { ok, readJson, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; userId: string }> };

export const PATCH = route(async (request: Request, { params }: Params) => {
  const { id, userId } = await params;
  await readJson(request, groupAdminUpdateSchema);
  const viewer = await requireGroupOwner(id);
  await transferGroupOwnership({ actorId: viewer.userId, groupId: id, targetUserId: userId });
  return ok({ ok: true });
});

export const DELETE = route(async (_request: Request, { params }: Params) => {
  const { id, userId } = await params;
  const viewer = await requireGroupOwner(id);
  await removeGroupAdmin({ actorId: viewer.userId, groupId: id, targetUserId: userId });
  return ok({ ok: true });
});
