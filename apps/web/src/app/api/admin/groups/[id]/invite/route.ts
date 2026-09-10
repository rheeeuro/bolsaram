/**
 * POST /api/admin/groups/[id]/invite — 동료 주선자 초대 코드 발급
 *
 * 평문 코드는 이 응답에 한 번만 실린다. 다시 조회할 수 없고 로그에 남기지 않는다.
 */
import { requireGroupAdmin } from "@/server/auth/guard";
import { issueGroupInvite } from "@/server/auth/group-invite";
import { ok, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export const POST = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const viewer = await requireGroupAdmin(id);
  const issued = await issueGroupInvite({ groupId: id, createdBy: viewer.userId });
  return ok({ code: issued.code, expiresAt: issued.expiresAt }, { status: 201 });
});
