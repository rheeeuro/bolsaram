/** 신청 관리 — 연결된 건을 확인하고 종료로 마무리한다 (설계문서 §6). */
import { withRls } from "@bolsaram/db";
import { MATCH_REQUEST_STATUSES, type MatchRequestStatus } from "@bolsaram/schemas";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { env } from "@/server/env";
import { introducedWithManaged, listForAdmin } from "@/server/repo/matches";
import { canEditProfiles, findProfilesByIds, type ProfileRecord } from "@/server/repo/profiles";
import { toCardView } from "@/server/views/profile-view";
import { listPendingIntents } from "@/server/repo/match-intents";
import { HostRequestList } from "@/components/host/request-list";
import { HostIntentQueue } from "@/components/host/intent-queue";
import { Count, PageHeader } from "@/components/host/surface";

export const dynamic = "force-dynamic";

/**
 * 받은 신청을 알릴 때 보내는 주소. 상대가 누구인지 담지 않는다 — 로그인한 본인만
 * 받은 탭에서 상대 카드를 보고 답한다. 세션이 없으면 입장 화면을 거쳐 여기로 돌아온다.
 */
const SIGNALS_INCOMING = "/signals?tab=incoming";

export default async function HostRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const viewer = await requireAdminPage();
  const { status } = await searchParams;
  const filter = MATCH_REQUEST_STATUSES.includes(status as MatchRequestStatus)
    ? [status as MatchRequestStatus]
    : undefined;

  const { items, intents } = await withRls(rlsContextOf(viewer), async (sql) => {
    const requests = await listForAdmin(sql, {
      groupId: viewer.groupId,
      ...(filter ? { status: filter } : {}),
    });
    // 멤버가 낸 요청은 아직 신청이 아니다 — 승인해야 상대에게 간다(0026).
    const pending = await listPendingIntents(sql);

    const byRequestId = new Map(requests.map((r) => [r.id, r]));
    const ids = new Set([
      ...requests.flatMap((r) => [r.requesterProfileId, r.targetProfileId]),
      ...pending.flatMap((i) => {
        const request = i.matchRequestId ? byRequestId.get(i.matchRequestId) : undefined;
        return [
          i.profileId,
          i.targetProfileId,
          request?.requesterProfileId,
          request?.targetProfileId,
        ].filter((v): v is string => v != null);
      }),
    ]);
    const profiles = await findProfilesByIds(sql, [...ids]);
    const byId = new Map(profiles.map((p) => [p.id, p]));

    // 이름은 담당 멤버와, 그 멤버와 연결된 상대에게만 보인다. 전체공개 풀에서는
    // 신청의 반대편이 남의 멤버일 수 있다.
    const editable = await canEditProfiles(sql, [...ids]);
    const introduced = await introducedWithManaged(sql);
    const describe = (profile: ProfileRecord | undefined) => {
      if (!profile) return null;
      const card = toCardView(profile);
      const named = editable.has(profile.id) || introduced.has(profile.id);
      return {
        id: profile.id,
        code: card.code,
        name: named ? profile.realName : null,
        imageUrl: card.primaryImage?.url ?? null,
        birthYear: card.birthYear,
      };
    };

    return {
      items: requests.map((request) => {
        const target = byId.get(request.targetProfileId);
        return {
          id: request.id,
          status: request.status,
          message: request.message,
          requestedAt: request.requestedAt.toISOString(),
          requester: describe(byId.get(request.requesterProfileId)),
          target: describe(target),
          // 멤버에게는 알림이 가지 않는다 — 받은 신청은 받는 쪽 담당자가 카카오톡으로
          // 전한다. 들어온 적이 없는 분이면 링크와 함께 초대도 보내야 한다.
          notify:
            request.status === "REQUESTED" && target && editable.has(target.id)
              ? { joined: target.userId != null }
              : null,
        };
      }),
      intents: pending.map((intent) => {
        const request = intent.matchRequestId
          ? byRequestId.get(intent.matchRequestId)
          : undefined;
        // 답이면 그 신청의 반대편이 상대다.
        const otherId =
          intent.targetProfileId ??
          (request
            ? request.requesterProfileId === intent.profileId
              ? request.targetProfileId
              : request.requesterProfileId
            : null);
        return {
          id: intent.id,
          kind: intent.kind,
          message: intent.message,
          createdAt: intent.createdAt.toISOString(),
          from: describe(byId.get(intent.profileId)),
          to: otherId ? describe(byId.get(otherId)) : null,
        };
      }),
    };
  });

  return (
    <>
      <PageHeader
        title="신청"
        description="멤버끼리 보낸 신청입니다. 서로 수락하면 연결되고, 만남이 끝나면 종료합니다."
        aside={<Count>{items.length}건</Count>}
      />
      <HostIntentQueue items={intents} />
      <HostRequestList
        items={items}
        activeStatus={status ?? ""}
        signalsUrl={`${env().APP_ORIGIN}${SIGNALS_INCOMING}`}
      />
    </>
  );
}
