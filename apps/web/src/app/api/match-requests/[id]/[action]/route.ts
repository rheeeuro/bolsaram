/**
 * POST /api/match-requests/:id/accept|reject|cancel
 * 당사자가 수행하는 상태 전이. 판정은 도메인 레이어가 하고 여기서는 입력만 검증한다.
 */
import { DomainError } from "@bolsaram/domain";
import { rejectMatchRequestSchema } from "@bolsaram/schemas";
import { writeAudit } from "@/server/audit";
import { asMember } from "@/server/http/context";
import { scheduleDispatch } from "@/server/notify/dispatch";
import { ok, route } from "@/server/http/respond";
import { actorFor, findById, transition } from "@/server/repo/matches";

export const dynamic = "force-dynamic";

const MEMBER_ACTIONS = new Set(["accept", "reject", "cancel"]);

type Params = { params: Promise<{ id: string; action: string }> };

export const POST = route(async (request: Request, { params }: Params) => {
  const { id, action } = await params;
  if (!MEMBER_ACTIONS.has(action)) {
    throw new DomainError("VALIDATION", `지원하지 않는 동작입니다: ${action}`);
  }

  // reject 만 본문을 받는다. 본문이 없어도 동작해야 한다.
  let reason: string | undefined;
  if (action === "reject") {
    const text = await request.text();
    if (text.length > 0) {
      reason = rejectMatchRequestSchema.parse(JSON.parse(text)).reason;
    }
  }

  return asMember(async (sql, viewer) => {
    const record = await findById(sql, id);
    if (!record) throw new DomainError("NOT_FOUND", "신청을 찾을 수 없습니다.");

    const updated = await transition(sql, {
      id,
      action: action as "accept" | "reject" | "cancel",
      actor: actorFor(record, viewer),
      current: record.status,
      ...(reason !== undefined ? { rejectReason: reason } : {}),
    });

    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: `match.${action}`,
      entityType: "match_request",
      entityId: id,
      metadata: { from: record.status, to: updated.status },
    });
    // 수락은 주선자가 연결해야 다음으로 간다. 알림 행은 트리거가 만들었고
    // (accept 가 아니면 아무것도 안 만든다) 여기서는 보내기만 띄운다.
    scheduleDispatch();
    return ok({ id: updated.id, status: updated.status });
  });
});
