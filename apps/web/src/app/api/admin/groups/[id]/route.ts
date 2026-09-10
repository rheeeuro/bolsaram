/**
 * 모임 하나.
 *
 *   PATCH  이름·설명 수정
 *   DELETE 모임 나가기
 *
 * 둘 다 그 모임의 주선자만 할 수 있다. 인증 레이어(owner 커넥션)로 돌기 때문에
 * RLS 가 걸리지 않는다 — `requireGroupAdmin` 이 유일한 소속 확인이다.
 */
import { groupUpdateSchema } from "@bolsaram/schemas";
import { requireGroupAdmin } from "@/server/auth/guard";
import { leaveGroup, updateGroup } from "@/server/auth/group-invite";
import { ok, readJson, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const PATCH = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const input = await readJson(request, groupUpdateSchema);
  await requireGroupAdmin(id);
  await updateGroup({ groupId: id, ...input });
  return ok({ ok: true });
});

export const DELETE = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const viewer = await requireGroupAdmin(id);
  const result = await leaveGroup(viewer.userId, id);
  return ok(result);
});
