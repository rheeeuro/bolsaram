/** PATCH /api/profiles/:id/status — 게시/중지 등 상태 전환 (관리자) */
import { DomainError } from "@bolsaram/domain";
import { profileStatusUpdateSchema } from "@bolsaram/schemas";
import { writeAudit } from "@/server/audit";
import { asAdmin } from "@/server/http/context";
import { ok, readJson, route } from "@/server/http/respond";
import { updateProfileStatus } from "@/server/repo/profiles";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const PATCH = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const input = await readJson(request, profileStatusUpdateSchema);
  return asAdmin(async (sql, viewer) => {
    const updated = await updateProfileStatus(sql, id, input.status, input.visibility);
    if (!updated) throw new DomainError("NOT_FOUND", "프로필을 찾을 수 없습니다.");
    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "profile.status",
      entityType: "profile",
      entityId: id,
      metadata: { status: input.status, visibility: input.visibility ?? null },
    });
    return ok({ ok: true });
  });
});
