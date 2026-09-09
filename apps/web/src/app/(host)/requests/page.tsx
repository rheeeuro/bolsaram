/** 신청 관리 — 연결된 건을 확인하고 종료로 마무리한다 (설계문서 §6). */
import { withRls } from "@bolsaram/db";
import { MATCH_REQUEST_STATUSES, type MatchRequestStatus } from "@bolsaram/schemas";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { listForAdmin } from "@/server/repo/matches";
import { findProfilesByIds, type ProfileRecord } from "@/server/repo/profiles";
import { toCardView } from "@/server/views/profile-view";
import { HostRequestList } from "@/components/host/request-list";
import { Count, PageHeader } from "@/components/host/surface";

export const dynamic = "force-dynamic";

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

  const items = await withRls(rlsContextOf(viewer), async (sql) => {
    const requests = await listForAdmin(sql, filter ? { status: filter } : {});
    const ids = new Set(requests.flatMap((r) => [r.requesterProfileId, r.targetProfileId]));
    const profiles = await findProfilesByIds(sql, [...ids]);
    const byId = new Map(profiles.map((p) => [p.id, p]));

    return requests.map((request) => ({
      id: request.id,
      status: request.status,
      message: request.message,
      requestedAt: request.requestedAt.toISOString(),
      requester: describe(byId.get(request.requesterProfileId)),
      target: describe(byId.get(request.targetProfileId)),
    }));
  });

  return (
    <>
      <PageHeader
        title="신청"
        description="누가 누구에게 마음을 보냈는지 봅니다. 서로 수락하면 연결이 되고, 만남이 끝나면 종료합니다."
        aside={<Count>{items.length}건</Count>}
      />
      <HostRequestList items={items} activeStatus={status ?? ""} />
    </>
  );
}

/** 목록에 사람이 보이게 사진과 공개 번호를 함께 싣는다. 이름은 주선자만 본다. */
function describe(profile: ProfileRecord | undefined) {
  if (!profile) return null;
  const card = toCardView(profile);
  return {
    id: profile.id,
    code: card.code,
    name: profile.realName,
    imageUrl: card.primaryImage?.url ?? null,
    birthYear: card.birthYear,
  };
}
