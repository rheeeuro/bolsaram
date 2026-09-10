/** 주선자 홈 — 오늘 손이 가야 할 것부터 보여준다 (설계문서 §6). */
import Link from "next/link";
import { withRls } from "@bolsaram/db";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { findProfilesByIds } from "@/server/repo/profiles";
import { toCardView } from "@/server/views/profile-view";
import { Panel, Stat, Thumb } from "@/components/host/surface";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { label } from "@/lib/labels";

export const dynamic = "force-dynamic";

type Kpi = {
  profilesActive: number;
  profilesTotal: number;
  profilesUnclaimed: number;
  requestsPending: number;
  requestsIntroduced: number;
  inboxPending: number;
  membersTotal: number;
};

type RecentRow = {
  id: string;
  status: string;
  requested_at: Date;
  requester_profile_id: string;
  target_profile_id: string;
};

export default async function HostHomePage() {
  const viewer = await requireAdminPage();

  const { kpi, recent } = await withRls(rlsContextOf(viewer), async (sql) => {
    // 홈은 단일 왕복으로 끝낸다. 카운트가 늘어나면 뷰로 뺀다.
    const stats = await sql.query<Kpi>(`
      SELECT
        -- 회원이 실제로 보는 조건과 같아야 한다. 상태만 세면 「공개인데 안 보이는」
        -- 프로필까지 들어가 숫자가 부풀려진다(isDiscoverable · filters.ts).
        (SELECT count(*) FROM profiles
          WHERE status IN ('ACTIVE','MATCHING') AND visibility = 'LISTED')::int AS "profilesActive",
        (SELECT count(*) FROM profiles)::int AS "profilesTotal",
        (SELECT count(*) FROM profiles WHERE user_id IS NULL)::int AS "profilesUnclaimed",
        (SELECT count(*) FROM match_requests WHERE status = 'REQUESTED')::int AS "requestsPending",
        (SELECT count(*) FROM match_requests WHERE status = 'INTRODUCED')::int AS "requestsIntroduced",
        (SELECT count(*) FROM import_sessions
          WHERE status IN ('RECEIVED','UPLOADING','ANALYZING','REVIEW_REQUIRED','READY','FAILED'))::int AS "inboxPending",
        (SELECT count(*) FROM users WHERE role = 'MEMBER')::int AS "membersTotal"
    `);

    const requests = await sql.query<RecentRow>(`
      SELECT id, status, requested_at, requester_profile_id, target_profile_id
        FROM match_requests
       ORDER BY requested_at DESC
       LIMIT 6
    `);

    // 사람이 보이는 목록이라야 주선자가 판단한다 — 사진과 공개 번호를 같이 싣는다.
    const ids = new Set(
      requests.rows.flatMap((r) => [r.requester_profile_id, r.target_profile_id]),
    );
    const profiles = await findProfilesByIds(sql, [...ids]);
    const byId = new Map(profiles.map((p) => [p.id, toCardView(p)]));

    return {
      kpi: stats.rows[0]!,
      recent: requests.rows.map((row) => ({
        id: row.id,
        status: row.status,
        requestedAt: row.requested_at,
        requester: byId.get(row.requester_profile_id) ?? null,
        target: byId.get(row.target_profile_id) ?? null,
      })),
    };
  });

  return (
    <>
      <section className="animate-fade mb-8">
        <p className="kicker mb-3">Today</p>
        <h1 className="display text-[30px] leading-snug text-[var(--color-ink-900)]">
          {greeting(kpi)}
        </h1>
        <p className="mt-2.5 text-[13.5px] leading-relaxed text-[var(--surface-text-muted)]">
          좋은 사람을, 좋은 방식으로. 오늘 주선자가 볼 것만 모았습니다.
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="답을 기다리는 신청"
          value={kpi.requestsPending}
          hint="상대가 아직 답하지 않았습니다"
          href="/requests?status=REQUESTED"
          accent={kpi.requestsPending > 0}
        />
        <Stat
          label="가져오기 대기"
          value={kpi.inboxPending}
          hint="검토·분석이 남았습니다"
          href="/imports"
          accent={kpi.inboxPending > 0}
        />
        <Stat
          label="회원에게 보이는 프로필"
          value={kpi.profilesActive}
          hint={`등록한 프로필 ${kpi.profilesTotal}명`}
          href="/profiles?status=ACTIVE"
        />
        <Stat
          label="들어온 회원"
          value={kpi.membersTotal}
          hint={`초대를 기다리는 프로필 ${kpi.profilesUnclaimed}개`}
          href="/members"
        />
      </div>

      {kpi.requestsIntroduced > 0 ? (
        <Link
          href="/requests?status=INTRODUCED"
          className="mt-4 flex items-center justify-between gap-4 rounded-[var(--radius-card)] border border-[var(--color-rose-200)] bg-[var(--color-rose-100)] px-5 py-4 transition-colors hover:border-[var(--color-rose-300)]"
        >
          <p className="display text-[15px] leading-relaxed text-[var(--color-burgundy-800)]">
            서로 마음이 닿은 {kpi.requestsIntroduced}건이 진행 중입니다.
          </p>
          <span className="shrink-0 text-[13px] text-[var(--color-rose-600)]">
            연결 보기 →
          </span>
        </Link>
      ) : null}

      <div className="mt-8 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Panel
          title="최근 신청"
          action={
            <Link
              href="/requests"
              className="text-[12.5px] text-[var(--color-rose-600)] hover:underline"
            >
              전체 보기
            </Link>
          }
        >
          {recent.length === 0 ? (
            <p className="py-10 text-center text-[13.5px] text-[var(--surface-text-muted)]">
              아직 신청이 없습니다. 프로필을 공개하면 여기에 쌓입니다.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {recent.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[var(--surface-border)] px-3 py-2.5"
                >
                  <Party
                    code={item.requester?.code ?? "삭제됨"}
                    url={item.requester?.primaryImage?.url}
                    href={item.requester ? `/profiles/${item.requester.id}` : undefined}
                  />
                  <span className="text-[13px] text-[var(--color-rose-400)]">→</span>
                  <Party
                    code={item.target?.code ?? "삭제됨"}
                    url={item.target?.primaryImage?.url}
                    href={item.target ? `/profiles/${item.target.id}` : undefined}
                  />
                  <div className="ml-auto flex items-center gap-2.5">
                    <Badge tone={toneForStatus(item.status)}>
                      {label.matchStatus(item.status)}
                    </Badge>
                    <span className="text-[12px] text-[var(--surface-text-muted)]">
                      {item.requestedAt.toLocaleString("ko-KR", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="바로 하기">
          <div className="flex flex-col gap-2">
            <QuickLink
              href="/imports"
              title="카카오톡 프로필 가져오기"
              description="사진과 글을 올리면 AI가 항목을 채웁니다."
            />
            <QuickLink
              href="/profiles?status=INACTIVE"
              title="게시를 기다리는 프로필"
              description="검토가 끝난 프로필을 공개합니다."
            />
            <QuickLink
              href="/members"
              title="초대 링크 · 입장코드 보내기"
              description="회원은 이 링크로만 들어옵니다."
            />
            <QuickLink
              href="/group"
              title="모임 설정"
              description="모임 정보와 동료 주선자를 관리합니다."
            />
          </div>
        </Panel>
      </div>
    </>
  );
}

/** 홈 첫 문장. 지금 손이 가야 할 것 하나만 말한다. */
function greeting(kpi: Kpi): string {
  if (kpi.requestsPending > 0) {
    return `${kpi.requestsPending}건의 신청이 답을 기다립니다.`;
  }
  if (kpi.inboxPending > 0) {
    return `가져온 프로필 ${kpi.inboxPending}건이 검토를 기다립니다.`;
  }
  if (kpi.profilesActive === 0) {
    return "첫 프로필을 등록해 보세요.";
  }
  return "오늘은 조용합니다.";
}

function Party({
  code,
  url,
  href,
}: {
  code: string;
  url: string | undefined;
  href: string | undefined;
}) {
  const body = (
    <>
      <Thumb url={url} size="sm" />
      <span className="display text-[14px] text-[var(--surface-text)]">{code}</span>
    </>
  );
  return href ? (
    <Link href={href} className="flex items-center gap-2 hover:opacity-80">
      {body}
    </Link>
  ) : (
    <span className="flex items-center gap-2 text-[var(--surface-text-muted)]">{body}</span>
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
      className="rounded-[12px] border border-[var(--surface-border)] px-4 py-3 transition-colors duration-[var(--duration-quick)] hover:border-[var(--color-rose-300)] hover:bg-[var(--color-ivory-100)]"
    >
      <p className="display text-[14px] text-[var(--surface-text)]">{title}</p>
      <p className="mt-1 text-[12px] text-[var(--surface-text-muted)]">{description}</p>
    </Link>
  );
}
