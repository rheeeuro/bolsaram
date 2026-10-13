/**
 * DELETE /api/admin/groups/requests/:id — 기다리는 내 모임 만들기 요청 거두기
 *
 * 요청한 본인만 거둘 수 있고, 관리자가 이미 처리한 요청은 그대로 둔다.
 */
import { uuidSchema } from "@bolsaram/schemas";
import { requireAdmin } from "@/server/auth/guard";
import { cancelGroupCreationRequest } from "@/server/auth/group-invite";
import { ok, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const DELETE = route(async (_request: Request, { params }: Params) => {
  const requestId = uuidSchema.parse((await params).id);
  const viewer = await requireAdmin();
  await cancelGroupCreationRequest({ userId: viewer.userId, requestId });
  return ok({ canceled: true });
});
