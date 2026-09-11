/**
 * POST /api/admin/match-requests/:id/accept|reject|cancel|close
 *
 * 주선자가 **당사자를 대신해** 상태를 옮긴다.
 *
 * 회원에게는 아이디·비밀번호가 없고 세션은 초대 링크로만 생긴다. 등록된 사람이
 * 자기 휴대폰을 쓰지 않으면 세션 자체가 없고, 세션이 있던 회원도 30일이 지나면
 * 스스로 누를 수 없다. 그래서 수락·거절·취소는 당사자 경로만으로는 닫히지 않는다 —
 * 주선자가 카카오톡이나 대면으로 의사를 확인한 뒤 여기서 기록한다.
 *
 * 판정은 도메인 레이어가 한다(`resolveTransition`). 이 라우트는 새 규칙을 만들지
 * 않고, 상태 기계가 이미 `admin` 에게 허용해 둔 전이만 노출한다.
 *
 * **누구의 답인지가 누가 옮길 수 있는지를 정한다**(0038). 수락·거절은 받은 쪽 담당
 * 주선자만, 취소는 신청자 쪽 담당만 기록한다 — 수락은 연락처 상호 공개이고 그
 * 동의는 상대가 낸 것이어야 한다. 종료는 목록 정리이므로 양쪽 담당 누구나 한다.
 * RLS 가 같은 경계를 한 번 더 본다(`match_requests_admin_update`).
 */
import { DomainError, type MatchAction } from "@bolsaram/domain";
import { rejectMatchRequestSchema } from "@bolsaram/schemas";
import { writeAudit } from "@/server/audit";
import { asAdmin } from "@/server/http/context";
import { scheduleDispatch } from "@/server/notify/dispatch";
import { ok, route } from "@/server/http/respond";
import { findById, transition } from "@/server/repo/matches";
import { assertCanEditProfile } from "@/server/repo/profiles";

export const dynamic = "force-dynamic";

const ADMIN_ACTIONS = new Set<MatchAction>(["accept", "reject", "cancel", "close"]);

function asAction(value: string): MatchAction {
  if (!ADMIN_ACTIONS.has(value as MatchAction)) {
    throw new DomainError("VALIDATION", `지원하지 않는 동작입니다: ${value}`);
  }
  return value as MatchAction;
}

type Params = { params: Promise<{ id: string; action: string }> };

export const POST = route(async (request: Request, { params }: Params) => {
  const { id, action: raw } = await params;
  const action = asAction(raw);

  // reject 만 본문을 받는다. 본문이 없어도 동작해야 한다.
  let reason: string | undefined;
  if (action === "reject") {
    const text = await request.text();
    if (text.length > 0) {
      reason = rejectMatchRequestSchema.parse(JSON.parse(text)).reason;
    }
  }

  return asAdmin(async (sql, viewer) => {
    const record = await findById(sql, id);
    if (!record) throw new DomainError("NOT_FOUND", "신청을 찾을 수 없습니다.");

    // 답을 낸 사람의 담당인지 먼저 본다. RLS 도 같은 판정을 하지만 거기서 막히면
    // 0행 갱신으로 떨어져 「그 사이 상태가 바뀌었습니다」라는 엉뚱한 안내가 나간다.
    if (action !== "close") {
      await assertCanEditProfile(
        sql,
        action === "cancel" ? record.requesterProfileId : record.targetProfileId,
      );
    }

    const updated = await transition(sql, {
      id,
      action,
      actor: "admin",
      current: record.status,
      ...(reason !== undefined ? { rejectReason: reason } : {}),
    });

    // 대신 처리했다는 사실이 남아야 한다 — 당사자가 직접 누른 것과 구분된다.
    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: `match.${action}`,
      entityType: "match_request",
      entityId: id,
      metadata: { from: record.status, to: updated.status, onBehalf: true },
    });

    // 수락은 곧 연결이다. 알림 행은 트리거가 만들었고 여기서는 보내기만 띄운다.
    if (action === "accept") scheduleDispatch();

    return ok({ id: updated.id, status: updated.status });
  });
});
