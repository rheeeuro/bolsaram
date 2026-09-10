/**
 * 마음 보내기 / 시그널 목록 (설계문서 §10).
 *
 * 회원이 누르는 「마음 보내기」는 **결정이 아니라 요청**이다(0026). 주선자가 확인해야
 * 상대에게 전달된다 — 그때까지 상대는 아무것도 알지 못한다.
 *
 * 단 주선자가 대행 중이면 확인 단계를 한 번 더 두지 않는다. 자기가 낸 요청을 자기가
 * 승인하는 꼴이 되고, 판단은 이미 그 자리에서 이루어졌다.
 */
import { createMatchRequestSchema, matchRequestListQuerySchema } from "@bolsaram/schemas";
import { writeAudit } from "@/server/audit";
import { asMember } from "@/server/http/context";
import { scheduleDispatch } from "@/server/notify/dispatch";
import { ok, readJson, readQuery, route } from "@/server/http/respond";
import { assertRequestable, createMatchRequest, listSignals } from "@/server/repo/matches";
import { createIntent } from "@/server/repo/match-intents";
import { findProfilesByIds } from "@/server/repo/profiles";
import { toCardView } from "@/server/views/profile-view";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const input = await readJson(request, createMatchRequestSchema);
  return asMember(async (sql, viewer) => {
    // 알림 행은 DB 트리거가 만든다. 여기서는 보내기만 띄운다 — 응답을 기다리게
    // 하지 않는다(0017 아웃박스).
    if (viewer.actingProfileId) {
      const created = await createMatchRequest(sql, {
        requesterProfileId: viewer.profileId,
        targetProfileId: input.targetProfileId,
        ...(input.message ? { message: input.message } : {}),
      });
      await writeAudit(sql, {
        actorUserId: viewer.userId,
        action: "match.request",
        entityType: "match_request",
        entityId: created.id,
        metadata: { target: input.targetProfileId, onBehalf: true },
      });
      scheduleDispatch();
      return ok({ pending: false, id: created.id, status: created.status }, { status: 201 });
    }

    // 요청을 남기기 전에 신청과 **같은 판정**을 한다. 「확인 중」이라고 해놓고
    // 주선자가 승인할 때 비로소 막히면 안 된다.
    await assertRequestable(sql, viewer.profileId, input.targetProfileId);

    const intent = await createIntent(sql, {
      profileId: viewer.profileId,
      kind: "SEND",
      targetProfileId: input.targetProfileId,
      ...(input.message ? { message: input.message } : {}),
    });
    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "intent.create",
      entityType: "match_intent",
      entityId: intent.id,
      metadata: { kind: "SEND", target: input.targetProfileId },
    });
    scheduleDispatch();
    return ok({ pending: true, id: intent.id }, { status: 201 });
  });
});

export const GET = route(async (request: Request) => {
  const { direction } = readQuery(request, matchRequestListQuerySchema);
  return asMember(async (sql, viewer) => {
    const signals = await listSignals(sql, viewer.profileId, direction);

    // 상대 프로필을 한 번에 읽어 카드로 변환한다.
    const otherIds = signals.map((s) =>
      s.requesterProfileId === viewer.profileId ? s.targetProfileId : s.requesterProfileId,
    );
    const profiles = await findProfilesByIds(sql, [...new Set(otherIds)]);
    const byId = new Map(profiles.map((p) => [p.id, p]));

    return ok({
      items: signals.map((signal) => {
        const otherId =
          signal.requesterProfileId === viewer.profileId
            ? signal.targetProfileId
            : signal.requesterProfileId;
        const other = byId.get(otherId);
        return {
          id: signal.id,
          status: signal.status,
          message: signal.message,
          rejectReason: signal.rejectReason,
          introduceNote: signal.introduceNote,
          requestedAt: signal.requestedAt,
          respondedAt: signal.respondedAt,
          introducedAt: signal.introducedAt,
          isRequester: signal.requesterProfileId === viewer.profileId,
          profile: other ? toCardView(other) : null,
        };
      }),
    });
  });
});
