/** 신청 관리 — 연결된 건을 확인하고 종료로 마무리한다 (설계문서 §6). */
import { withRls } from "@bolsaram/db";
import { MATCH_REQUEST_STATUSES, type MatchRequestStatus } from "@bolsaram/schemas";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { listForAdmin } from "@/server/repo/matches";
import { findProfilesByIds } from "@/server/repo/profiles";
import { AdminRequestTable } from "@/components/admin/request-table";

export const dynamic = "force-dynamic";

export default async function AdminRequestsPage({
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
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="text-[18px] font-semibold tracking-tight">신청</h1>
        <span className="text-[12.5px] text-[var(--surface-text-muted)]">{items.length}건</span>
      </header>
      <AdminRequestTable items={items} activeStatus={status ?? ""} />
    </>
  );
}

function describe(
  profile: { id: string; publicCode: number; realName: string | null } | undefined,
) {
  if (!profile) return null;
  return { id: profile.id, code: `#${profile.publicCode}`, name: profile.realName };
}
