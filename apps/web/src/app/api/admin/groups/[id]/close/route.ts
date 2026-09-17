/**
 * DELETE /api/admin/groups/[id]/close — 모임 폐쇄
 *
 * 나가기(`DELETE /api/admin/groups/[id]`)와 갈라 둔 이유는 부르는 사람과 결과가
 * 다르기 때문이다 — 나가기는 소속 주선자 누구나 자기만 빠지지만, 폐쇄는 모임장이
 * 방 자체를 없앤다. 회원이나 가져온 프로필이 남아 있으면 서버가 막는다.
 */
import { requireGroupOwner } from "@/server/auth/guard";
import { closeGroup } from "@/server/auth/group-invite";
import { ok, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export const DELETE = route(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const viewer = await requireGroupOwner(id);
    const result = await closeGroup({ actorId: viewer.userId, groupId: id });
    return ok(result);
  },
);
