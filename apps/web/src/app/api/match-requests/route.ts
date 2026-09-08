/** 마음 보내기 / 시그널 목록 (설계문서 §10) */
import { createMatchRequestSchema, matchRequestListQuerySchema } from "@bolsaram/schemas";
import { writeAudit } from "@/server/audit";
import { asMember } from "@/server/http/context";
import { scheduleDispatch } from "@/server/notify/dispatch";
import { ok, readJson, readQuery, route } from "@/server/http/respond";
import { createMatchRequest, listSignals } from "@/server/repo/matches";
import { findProfilesByIds } from "@/server/repo/profiles";
import { toCardView } from "@/server/views/profile-view";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const input = await readJson(request, createMatchRequestSchema);
  return asMember(async (sql, viewer) => {
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
      metadata: { target: input.targetProfileId },
    });
    // 담당 주선자에게 알린다. 알림 행은 DB 트리거가 이미 만들었고, 여기서는
    // 보내기만 띄운다 — 응답을 기다리게 하지 않는다.
    scheduleDispatch();
    return ok({ id: created.id, status: created.status }, { status: 201 });
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
