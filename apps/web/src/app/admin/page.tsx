/** 관리자 대시보드 — KPI (설계문서 §6). */
import Link from "next/link";
import { withRls } from "@bolsaram/db";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { Card, Stat, Table, Td, Th } from "@/components/admin/table";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { label } from "@/lib/labels";

export const dynamic = "force-dynamic";

type Kpi = {
  profilesActive: number;
  profilesTotal: number;
  profilesUnclaimed: number;
  requestsPending: number;
  requestsAccepted: number;
  introducedTotal: number;
  inboxPending: number;
  membersTotal: number;
  consentPending: number;
  consentPendingListed: number;
};

export default async function AdminDashboard() {
  const viewer = await requireAdminPage();


  const { kpi, recent } = await withRls(rlsContextOf(viewer), async (sql) => {
    // 대시보드는 단일 왕복으로 끝낸다. 카운트가 늘어나면 뷰로 뺀다.
    const stats = await sql.query<Kpi>(`
      SELECT
        (SELECT count(*) FROM profiles WHERE status IN ('ACTIVE','MATCHING'))::int AS "profilesActive",
        (SELECT count(*) FROM profiles)::int AS "profilesTotal",
        (SELECT count(*) FROM profiles WHERE user_id IS NULL)::int AS "profilesUnclaimed",
        (SELECT count(*) FROM match_requests WHERE status = 'REQUESTED')::int AS "requestsPending",
        (SELECT count(*) FROM match_requests WHERE status = 'ACCEPTED')::int AS "requestsAccepted",
        (SELECT count(*) FROM match_requests WHERE status IN ('INTRODUCED','CLOSED'))::int AS "introducedTotal",
        (SELECT count(*) FROM import_sessions
          WHERE status IN ('RECEIVED','UPLOADING','ANALYZING','REVIEW_REQUIRED','READY','FAILED'))::int AS "inboxPending",
        (SELECT count(*) FROM users WHERE role = 'MEMBER')::int AS "membersTotal",
        -- 합성 데이터(SYNTHETIC)는 확인 대상이 아니라 지울 대상이라 빼둔다.
        (SELECT count(*) FROM profiles
          WHERE consent_method IS NULL OR consent_method = 'LEGACY')::int AS "consentPending",
        (SELECT count(*) FROM profiles
          WHERE (consent_method IS NULL OR consent_method = 'LEGACY')
            AND visibility <> 'PRIVATE')::int AS "consentPendingListed"
    `);

    const recentRequests = await sql.query<{
      id: string;
      status: string;
      requested_at: Date;
      requester_code: number;
      target_code: number;
    }>(`
      SELECT mr.id, mr.status, mr.requested_at,
             rp.public_code AS requester_code, tp.public_code AS target_code
        FROM match_requests mr
        JOIN profiles rp ON rp.id = mr.requester_profile_id
        JOIN profiles tp ON tp.id = mr.target_profile_id
       ORDER BY mr.requested_at DESC
       LIMIT 8
    `);

    return { kpi: stats.rows[0]!, recent: recentRequests.rows };
  });

  return (
    <>
      <h1 className="mb-5 text-[18px] font-semibold tracking-tight">대시보드</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="공개 프로필"
          value={kpi.profilesActive}
          hint={`전체 ${kpi.profilesTotal}명`}
        />
        <Stat
          label="처리 대기 신청"
          value={kpi.requestsPending}
          hint={`수락 후 연결 대기 ${kpi.requestsAccepted}건`}
        />
        <Stat label="Import 대기" value={kpi.inboxPending} hint="검토·분석 필요" />
        <Stat
          label="가입 회원"
          value={kpi.membersTotal}
          hint={`미연결 프로필 ${kpi.profilesUnclaimed}개`}
        />
      </div>

      {kpi.consentPending > 0 ? (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-[var(--color-danger)]/25 bg-[var(--color-danger)]/6 px-4 py-3">
          <p className="text-[13px]">
            등록 동의를 확인하지 않은 프로필이 <strong>{kpi.consentPending}건</strong>
            {kpi.consentPendingListed > 0 ? (
              <>
                {" "}
                있고, 그중 <strong>{kpi.consentPendingListed}건</strong>이 회원에게 보이고
                있습니다.
              </>
            ) : (
              " 있습니다."
            )}
          </p>
          <Link
            href="/admin/profiles?consent=pending"
            className="shrink-0 text-[13px] font-medium underline"
          >
            확인하러 가기
          </Link>
        </div>
      ) : null}

      {kpi.requestsAccepted > 0 ? (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-[var(--surface-accent)]/25 bg-[var(--surface-accent)]/6 px-4 py-3">
          <p className="text-[13px]">
            서로 마음이 닿은 <strong>{kpi.requestsAccepted}건</strong>이 연결을 기다리고
            있습니다.
          </p>
          <Link
            href="/admin/requests?status=ACCEPTED"
            className="text-[13px] font-medium text-[var(--surface-accent)] underline"
          >
            연결하러 가기
          </Link>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card
          title="최근 신청"
          action={
            <Link
              href="/admin/requests"
              className="text-[12.5px] text-[var(--surface-text-muted)] underline"
            >
              전체 보기
            </Link>
          }
        >
          {recent.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-[var(--surface-text-muted)]">
              아직 신청이 없습니다.
            </p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>신청자</Th>
                  <Th>대상</Th>
                  <Th>상태</Th>
                  <Th>신청 시각</Th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr key={row.id}>
                    <Td>#{row.requester_code}</Td>
                    <Td>#{row.target_code}</Td>
                    <Td>
                      <Badge tone={toneForStatus(row.status)}>
                        {label.matchStatus(row.status)}
                      </Badge>
                    </Td>
                    <Td className="text-[var(--surface-text-muted)]">
                      {row.requested_at.toLocaleString("ko-KR", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="빠른 작업">
          <div className="flex flex-col gap-2">
            <QuickLink
              href="/admin/imports"
              title="카카오톡 프로필 가져오기"
              description="사진과 글을 올려 AI로 프로필을 만듭니다."
            />
            <QuickLink
              href="/admin/profiles?status=INACTIVE"
              title="게시 대기 프로필"
              description="검토가 끝난 프로필을 공개합니다."
            />
            <QuickLink
              href="/admin/members"
              title="초대 링크 발급"
              description="등록한 프로필의 주인에게 링크를 보냅니다."
            />
            <QuickLink
              href="/admin/group"
              title="모임 설정"
              description="모임 정보와 동료 주선자를 관리합니다."
            />
          </div>
        </Card>

      </div>
    </>
  );
}

function QuickLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-[var(--surface-border)] px-3.5 py-3 transition-colors hover:bg-[var(--surface-muted)]"
    >
      <p className="text-[13.5px] font-medium">{title}</p>
      <p className="mt-0.5 text-[12px] text-[var(--surface-text-muted)]">{description}</p>
    </Link>
  );
}
