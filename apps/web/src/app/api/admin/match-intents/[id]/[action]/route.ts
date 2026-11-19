/**
 * POST /api/admin/match-intents/:id/approve|decline|reopen
 *
 * 멤버가 낸 요청을 주선자가 확인한다 (0026). reopen 은 보류를 풀어 확인 대기로
 * 되돌린다 — 보류는 영구 차단이 아니다(0030).
 *
 * 승인하면 그때 비로소 `match_requests` 가 만들어지거나 상태가 옮겨진다. 그 전까지
 * 상대는 아무것도 알지 못한다 — 요청 행 자체를 읽을 수 없다.
 *
 * 여기서 새 규칙을 만들지 않는다. 신청을 만들 수 있는 관계인지는 `assertRequestable`,
 * 옮길 수 있는 전이인지는 `resolveTransition` 이 그대로 판정한다.
 */
import { DomainError, actionForIntent, resolveTransition } from "@bolsaram/domain";
import { declineIntentSchema } from "@bolsaram/schemas";
import { writeAudit } from "@/server/audit";
import { asAdmin } from "@/server/http/context";
import { scheduleDispatch } from "@/server/notify/dispatch";
import { ok, route } from "@/server/http/respond";
import {
  actorFor,
  assertRequestable,
  createMatchRequest,
  findById,
  transition,
} from "@/server/repo/matches";
import { decideIntent, findIntentById, reopenIntent } from "@/server/repo/match-intents";

export const dynamic = "force-dynamic";

const ADMIN_ACTIONS = new Set(["approve", "decline", "reopen"]);

type Params = { params: Promise<{ id: string; action: string }> };

export const POST = route(async (request: Request, { params }: Params) => {
  const { id, action } = await params;
  if (!ADMIN_ACTIONS.has(action)) {
    throw new DomainError("VALIDATION", `지원하지 않는 동작입니다: ${action}`);
  }

  // decline 만 본문을 받는다. 본문이 없어도 동작해야 한다.
  let reason: string | undefined;
  if (action === "decline") {
    const text = await request.text();
    if (text.length > 0) {
      reason = declineIntentSchema.parse(JSON.parse(text)).reason;
    }
  }

  return asAdmin(async (sql, viewer) => {
    // RLS 가 담당 멤버의 요청만 남긴다. 남의 것은 여기서 이미 안 보인다.
    const intent = await findIntentById(sql, id);
    if (!intent) throw new DomainError("NOT_FOUND", "요청을 찾을 수 없습니다.");

    if (action === "reopen") {
      if (intent.status !== "DECLINED") {
        throw new DomainError("CONFLICT", "보류 상태가 아닌 요청입니다.");
      }
      // 승인할 때 막힐 요청이면 큐에 올리기 전에 지금 말한다. 판정은 승인과 같다.
      if (intent.kind === "SEND") {
        if (!intent.targetProfileId) {
          throw new DomainError("INVALID_STATE", "상대가 지정되지 않은 요청입니다.");
        }
        await assertRequestable(sql, intent.profileId, intent.targetProfileId);
      } else {
        const record = intent.matchRequestId
          ? await findById(sql, intent.matchRequestId)
          : null;
        const matchAction = actionForIntent(intent.kind);
        if (!record || !matchAction) {
          throw new DomainError("INVALID_STATE", "대상 신청이 없어 되돌릴 수 없습니다.");
        }
        try {
          resolveTransition({
            action: matchAction,
            current: record.status,
            actor: actorFor(record, { role: "MEMBER", profileId: intent.profileId }),
          });
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
          throw new DomainError(
            "INVALID_STATE",
            "그사이 신청 상태가 바뀌어 이 요청은 되돌릴 수 없습니다.",
            { status: record.status },
          );
        }
      }

      await reopenIntent(sql, id);
      await writeAudit(sql, {
        actorUserId: viewer.userId,
        action: "intent.reopen",
        entityType: "match_intent",
        entityId: id,
        metadata: { kind: intent.kind },
      });
      return ok({ ok: true, status: "PENDING" });
    }

    if (intent.status !== "PENDING") {
      throw new DomainError("CONFLICT", "이미 처리된 요청입니다.");
    }

    if (action === "decline") {
      await decideIntent(sql, {
        id,
        status: "DECLINED",
        decidedBy: viewer.userId,
        ...(reason !== undefined ? { declineReason: reason } : {}),
      });
      await writeAudit(sql, {
        actorUserId: viewer.userId,
        action: "intent.decline",
        entityType: "match_intent",
        entityId: id,
        metadata: { kind: intent.kind },
      });
      return ok({ ok: true, status: "DECLINED" });
    }

    // ── 승인 ────────────────────────────────────────────────
    // 요청을 먼저 닫는다. 조건부 UPDATE 라 두 주선자가 동시에 눌러도 한 번만 통과한다.
    await decideIntent(sql, { id, status: "APPROVED", decidedBy: viewer.userId });

    if (intent.kind === "SEND") {
      if (!intent.targetProfileId) {
        throw new DomainError("INVALID_STATE", "상대가 지정되지 않은 요청입니다.");
      }
      const created = await createMatchRequest(sql, {
        requesterProfileId: intent.profileId,
        targetProfileId: intent.targetProfileId,
        ...(intent.message ? { message: intent.message } : {}),
      });
      await writeAudit(sql, {
        actorUserId: viewer.userId,
        action: "intent.approve",
        entityType: "match_intent",
        entityId: id,
        metadata: { kind: intent.kind, matchRequestId: created.id },
      });
      scheduleDispatch();
      return ok({ ok: true, status: "APPROVED", matchRequestId: created.id });
    }

    if (!intent.matchRequestId) {
      throw new DomainError("INVALID_STATE", "대상 신청이 없는 요청입니다.");
    }
    const record = await findById(sql, intent.matchRequestId);
    if (!record) throw new DomainError("NOT_FOUND", "신청을 찾을 수 없습니다.");

    const matchAction = actionForIntent(intent.kind);
    if (!matchAction) throw new DomainError("INVALID_STATE", "옮길 수 없는 요청입니다.");

    // 행위자는 주선자가 아니라 **요청을 낸 멤버**이다. 주선자는 그 답을 옮길 뿐이다.
    const updated = await transition(sql, {
      id: record.id,
      action: matchAction,
      actor: actorFor(record, { role: "MEMBER", profileId: intent.profileId }),
      current: record.status,
      // 거절 사유는 요청의 message 로 들고 있었다.
      ...(intent.kind === "REJECT" && intent.message !== null
        ? { rejectReason: intent.message }
        : {}),
    });

    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "intent.approve",
      entityType: "match_intent",
      entityId: id,
      metadata: {
        kind: intent.kind,
        matchRequestId: record.id,
        from: record.status,
        to: updated.status,
      },
    });
    scheduleDispatch();
    return ok({ ok: true, status: "APPROVED", matchRequestId: record.id });
  });
});
