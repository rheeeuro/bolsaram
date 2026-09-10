/**
 * POST /api/match-requests/:id/accept|reject|cancel
 *
 * 당사자의 답. 판정은 도메인 레이어가 하고 여기서는 입력만 검증한다.
 *
 * 이 답도 **요청으로 남고 주선자가 확인해야 반영된다**(0026). 수락 자체가 본인의
 * 동의라는 사실은 그대로이고, 달라지는 것은 그 동의가 주선자를 거쳐 전달된다는 점이다.
 * 확인 전까지 상대는 아무것도 알지 못한다 — 요청 행을 읽을 수 없다.
 *
 * 주선자가 대행 중이면 바로 반영한다. 판단이 이미 그 자리에서 이루어졌다.
 */
import { DomainError, resolveTransition } from "@bolsaram/domain";
import { rejectMatchRequestSchema, type MatchIntentKind } from "@bolsaram/schemas";
import { writeAudit } from "@/server/audit";
import { asMember } from "@/server/http/context";
import { scheduleDispatch } from "@/server/notify/dispatch";
import { ok, route } from "@/server/http/respond";
import { actorFor, findById, transition } from "@/server/repo/matches";
import { createIntent } from "@/server/repo/match-intents";

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
    // 당사자가 아니면 여기서 막힌다.
    const actor = actorFor(record, viewer);
    const typed = action as "accept" | "reject" | "cancel";

    if (viewer.actingProfileId) {
      const updated = await transition(sql, {
        id,
        action: typed,
        actor,
        current: record.status,
        ...(reason !== undefined ? { rejectReason: reason } : {}),
      });
      await writeAudit(sql, {
        actorUserId: viewer.userId,
        action: `match.${action}`,
        entityType: "match_request",
        entityId: id,
        metadata: { from: record.status, to: updated.status, onBehalf: true },
      });
      // 알림 행은 트리거가 만들었고 여기서는 보내기만 띄운다.
      scheduleDispatch();
      return ok({ pending: false, id: updated.id, status: updated.status });
    }

    // 지금 가능한 전이인지 미리 판정한다 — 「확인 중」으로 뒀다가 주선자가 승인할
    // 때 비로소 막히면 안 된다. 여기서는 적용하지 않고 판정만 한다.
    resolveTransition({ action: typed, current: record.status, actor });

    // 거절 사유는 요청의 message 로 들고 있다가 승인 시 신청에 옮겨 적는다.
    const intent = await createIntent(sql, {
      profileId: viewer.profileId,
      kind: typed.toUpperCase() as MatchIntentKind,
      matchRequestId: id,
      ...(reason !== undefined ? { message: reason } : {}),
    });
    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "intent.create",
      entityType: "match_intent",
      entityId: intent.id,
      metadata: { kind: intent.kind, matchRequestId: id },
    });
    scheduleDispatch();
    return ok({ pending: true, id: intent.id });
  });
});
