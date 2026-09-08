/**
 * POST /api/admin/match-requests/:id/close
 * 주선자가 건을 종료한다. 연결은 상대의 수락으로 자동 처리되므로 여기서 하지 않는다.
 */
import { DomainError } from "@bolsaram/domain";
import { writeAudit } from "@/server/audit";
import { asAdmin } from "@/server/http/context";
import { ok, route } from "@/server/http/respond";
import { findById, transition } from "@/server/repo/matches";

export const dynamic = "force-dynamic";

const ADMIN_ACTIONS = new Set(["close"]);

type Params = { params: Promise<{ id: string; action: string }> };

export const POST = route(async (_request: Request, { params }: Params) => {
  const { id, action } = await params;
  if (!ADMIN_ACTIONS.has(action)) {
    throw new DomainError("VALIDATION", `지원하지 않는 동작입니다: ${action}`);
  }

  return asAdmin(async (sql, viewer) => {
    const record = await findById(sql, id);
    if (!record) throw new DomainError("NOT_FOUND", "신청을 찾을 수 없습니다.");

    const updated = await transition(sql, {
      id,
      action: "close",
      actor: "admin",
      current: record.status,
    });

    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: `match.${action}`,
      entityType: "match_request",
      entityId: id,
      metadata: { from: record.status, to: updated.status },
    });
    return ok({ id: updated.id, status: updated.status });
  });
});
