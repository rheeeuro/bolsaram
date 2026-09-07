/**
 * POST /api/admin/match-requests/:id/introduce|close
 * 주선자가 두 사람을 연결하거나 건을 종료한다.
 */
import { DomainError } from "@bolsaram/domain";
import { introduceMatchRequestSchema } from "@bolsaram/schemas";
import { writeAudit } from "@/server/audit";
import { asAdmin } from "@/server/http/context";
import { ok, route } from "@/server/http/respond";
import { findById, transition } from "@/server/repo/matches";

export const dynamic = "force-dynamic";

const ADMIN_ACTIONS = new Set(["introduce", "close"]);

type Params = { params: Promise<{ id: string; action: string }> };

export const POST = route(async (request: Request, { params }: Params) => {
  const { id, action } = await params;
  if (!ADMIN_ACTIONS.has(action)) {
    throw new DomainError("VALIDATION", `지원하지 않는 동작입니다: ${action}`);
  }

  let note: string | undefined;
  if (action === "introduce") {
    const text = await request.text();
    if (text.length > 0) {
      note = introduceMatchRequestSchema.parse(JSON.parse(text)).note;
    }
  }

  return asAdmin(async (sql, viewer) => {
    const record = await findById(sql, id);
    if (!record) throw new DomainError("NOT_FOUND", "신청을 찾을 수 없습니다.");

    const updated = await transition(sql, {
      id,
      action: action as "introduce" | "close",
      actor: "admin",
      current: record.status,
      ...(note !== undefined ? { introduceNote: note } : {}),
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
