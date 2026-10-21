/** 주선자 홈 — 오늘 손이 가야 할 것부터 보여준다 (설계문서 §6). */
import Link from "next/link";
import { withRls } from "@bolsaram/db";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { canEditProfiles, findProfilesByIds } from "@/server/repo/profiles";
import { introducedWithManaged } from "@/server/repo/matches";
import { countHostTodo, type HostTodo } from "@/server/repo/host-todo";
import { toCardView } from "@/server/views/profile-view";
import { Panel, Stat, Thumb } from "@/components/host/surface";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { ProfileCode } from "@/components/ui/marks";
import { label } from "@/lib/labels";
import { formatDay } from "@/lib/dates";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

type Kpi = {
  profilesActive: number;
  profilesTotal: number;
  requestsPending: number;
  requestsIntroduced: number;
  membersTotal: number;
  /** 어느 채널이든 내가 등록한 프로필 수. 0 이면 처음 온 주선자로 보고 시작 순서를 보여준다. */
  myProfiles: number;
  /** 내가 초대 링크를 한 번이라도 발급했는가. */
  invited: boolean;
  telegramLinked: boolean;
};

type RecentRow = {
  id: string;
  status: string;
  requested_at: Date;
  requester_profile_id: string;
  target_profile_id: string;
};

type PartyView = { id: string; code: string; name: string | null; url: string | undefined };

export default async function HostHomePage() {
  const viewer = await requireAdminPage();
  const activeName =
    viewer.groups.find((group) => group.id === viewer.groupId)?.name ?? "전체공개";

  const { kpi, todo, recent } = await withRls(rlsContextOf(viewer), async (sql) => {
    // 모든 숫자가 **지금 보고 있는 채널** 안의 것이다(할 일의 범위는 host-todo 참고).
    // `$1` 이 null 이면 전체공개 풀을 센다.
    const stats = await sql.query<Kpi>(
      `
      SELECT
        -- 멤버가 실제로 보는 조건과 같아야 한다(isDiscoverable · filters.ts).
        (SELECT count(*) FROM profiles
          WHERE group_id IS NOT DISTINCT FROM $1 AND status = 'ACTIVE')::int AS "profilesActive",
        (SELECT count(*) FROM profiles
          WHERE group_id IS NOT DISTINCT FROM $1)::int AS "profilesTotal",
        (SELECT count(*) FROM match_requests r
          WHERE r.status = 'REQUESTED' AND EXISTS (
            SELECT 1 FROM profiles p WHERE p.id = r.requester_profile_id
                                       AND p.group_id IS NOT DISTINCT FROM $1))::int AS "requestsPending",
        (SELECT count(*) FROM match_requests r
          WHERE r.status = 'INTRODUCED' AND EXISTS (
            SELECT 1 FROM profiles p WHERE p.id = r.requester_profile_id
                                       AND p.group_id IS NOT DISTINCT FROM $1))::int AS "requestsIntroduced",
        (SELECT count(*) FROM profiles
          WHERE group_id IS NOT DISTINCT FROM $1 AND user_id IS NOT NULL)::int AS "membersTotal",
        (SELECT count(*) FROM profiles WHERE created_by = $2)::int AS "myProfiles",
        EXISTS (SELECT 1 FROM invites WHERE created_by = $2) AS "invited",
        -- 연결 행은 본인 것만 보인다(RLS).
        EXISTS (SELECT 1 FROM telegram_connections WHERE user_id = $2) AS "telegramLinked"
    `,
      [viewer.groupId, viewer.userId],
    );

    const requests = await sql.query<RecentRow>(
      `
      SELECT r.id, r.status, r.requested_at, r.requester_profile_id, r.target_profile_id
        FROM match_requests r
       WHERE EXISTS (SELECT 1 FROM profiles p
                      WHERE p.id = r.requester_profile_id
                        AND p.group_id IS NOT DISTINCT FROM $1)
       ORDER BY r.requested_at DESC
       LIMIT 6
    `,
      [viewer.groupId],
    );

    // 사람이 보이는 목록이라야 주선자가 판단한다 — 사진과 공개 번호를 같이 싣는다.
    // 이름은 신청 화면과 같은 기준이다: 담당 멤버와, 그 멤버와 연결된 상대만.
    const ids = [
      ...new Set(requests.rows.flatMap((r) => [r.requester_profile_id, r.target_profile_id])),
    ];
    const profiles = await findProfilesByIds(sql, ids);
    const editable = await canEditProfiles(sql, ids);
    const introduced = await introducedWithManaged(sql);
    const byId = new Map<string, PartyView>(
      profiles.map((p) => {
        const card = toCardView(p);
        const named = editable.has(p.id) || introduced.has(p.id);
        return [
          p.id,
          {
            id: p.id,
            code: card.code,
            name: named ? p.realName : null,
            url: card.primaryImage?.url,
          },
        ];
      }),
    );

    return {
      kpi: stats.rows[0]!,
      todo: await countHostTodo(sql, viewer.groupId),
      recent: requests.rows.map((row) => ({
        id: row.id,
        status: row.status,
        requestedAt: row.requested_at,
        requester: byId.get(row.requester_profile_id) ?? null,
        target: byId.get(row.target_profile_id) ?? null,
      })),
    };
  });

  const tasks = todoItems(todo);
  // 첫 멤버를 올리고 초대까지 보내 보기 전에는 시작 순서를 맨 위에 둔다.
  const starting = kpi.myProfiles === 0 || !kpi.invited;
  // 채널이 비어 있으면 숫자 넷이 전부 0 이다 — 아무것도 말하지 않으니 그리지 않는다.
  const quiet = kpi.profilesTotal === 0 && recent.length === 0;

  return (
    <>
      <section className="animate-fade mb-6">
        {/* 아래 숫자는 전부 보고 있는 채널 안의 것이다. 어디를 세고 있는지 먼저 말한다. */}
        <p className="mb-2 text-[12px] text-[var(--surface-text-muted)]">{activeName}</p>
        <h1 className="display text-[28px] leading-snug text-[var(--color-ink-900)] lg:text-[30px]">
          {greeting(todo, kpi)}
        </h1>
      </section>

      {starting ? <StartSteps kpi={kpi} /> : null}

      {tasks.length > 0 || !starting ? (
        <Panel title="오늘 할 일" className="mb-6">
          {tasks.length === 0 ? (
            <p className="py-4 text-center text-[13.5px] text-[var(--surface-text-muted)]">
              지금 처리할 일이 없습니다. 새 요청이나 가져오기가 생기면 여기에 올라옵니다.
            </p>
          ) : (
            <ul className="-my-1 divide-y divide-[var(--surface-border)]">
              {tasks.map((task) => (
                <li key={task.href}>
                  <TaskRow {...task} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      {quiet ? null : (
        <>
          <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="멤버에게 보이는 분"
              value={kpi.profilesActive}
              hint={`등록 ${kpi.profilesTotal}명 중`}
              href="/profiles?status=ACTIVE"
            />
            <Stat
              label="들어온 멤버"
              value={kpi.membersTotal}
              hint="초대 링크로 들어온 분"
              href="/invites"
            />
            <Stat
              label="진행 중인 연결"
              value={kpi.requestsIntroduced}
              hint="서로 마음이 닿았습니다"
              href="/requests?status=INTRODUCED"
            />
            <Stat
              label="답을 기다리는 신청"
              value={kpi.requestsPending}
              hint="받은 분이 아직 답하지 않았습니다"
              href="/requests?status=REQUESTED"
            />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
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
                <ul className="stagger flex flex-col gap-2.5">
                  {recent.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border border-[var(--surface-border)] px-3 py-2.5"
                    >
                      <Party party={item.requester} />
                      <span
                        aria-label="에게"
                        className="text-[13px] text-[var(--color-rose-400)]"
                      >
                        →
                      </span>
                      <Party party={item.target} />
                      <div className="ml-auto flex items-center gap-2.5">
                        <Badge tone={toneForStatus(item.status)}>
                          {label.matchStatus(item.status)}
                        </Badge>
                        <span className="text-[12px] text-[var(--surface-text-muted)]">
                          {formatDay(item.requestedAt.toISOString())}
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
                  href="/invites"
                  title="초대 보내기"
                  description="멤버는 이 링크로만 들어옵니다."
                />
                <QuickLink
                  href="/profiles?status=INACTIVE"
                  title="비활성 멤버"
                  description="멤버에게 안 보이는 분을 다시 공개합니다."
                />
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}

type Task = { href: string; count: number; title: string; description: string; action: string };

/** 처리해야 끝나는 일만, 급한 순서로. 0 인 줄은 빼서 남은 것이 곧 할 일이 되게 한다. */
function todoItems(todo: HostTodo): Task[] {
  const all: Task[] = [
    {
      href: "/requests",
      count: todo.intentsPending,
      title: "확인을 기다리는 요청",
      description: "멤버가 보낸 마음입니다. 확인해야 상대에게 전달됩니다.",
      action: "확인하기",
    },
    {
      href: "/requests?status=REQUESTED",
      count: todo.requestsToRelay,
      title: "내 멤버가 받은 신청",
      description: "멤버 화면에는 알림이 없습니다. 카카오톡으로 알려 주세요.",
      action: "알리기",
    },
    {
      href: "/imports",
      count: todo.importsPending,
      title: "검토할 가져오기",
      description: "AI가 채운 항목을 확인하고 등록합니다.",
      action: "검토하기",
    },
    {
      href: "/invites",
      count: todo.invitesToSend,
      title: "초대를 보낼 멤버",
      description: "아직 안 보냈거나 기한이 지난 분입니다. 링크로만 들어옵니다.",
      action: "초대하기",
    },
  ];
  return all.filter((task) => task.count > 0);
}

/** 홈 첫 문장. 지금 손이 가야 할 것 하나만 말한다. */
function greeting(todo: HostTodo, kpi: Kpi): string {
  if (todo.intentsPending > 0)
    return `확인을 기다리는 요청이 ${todo.intentsPending}건 있습니다.`;
  if (todo.requestsToRelay > 0)
    return `내 멤버에게 알릴 신청이 ${todo.requestsToRelay}건 있습니다.`;
  if (todo.importsPending > 0)
    return `가져온 프로필 ${todo.importsPending}건이 검토를 기다립니다.`;
  if (kpi.myProfiles === 0) return "첫 멤버를 등록해 보세요.";
  return "오늘은 조용합니다.";
}

function TaskRow({ href, count, title, description, action }: Task) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 py-3 transition-colors duration-[var(--duration-quick)]"
    >
      <span className="display grid size-11 shrink-0 place-items-center rounded-full bg-[var(--color-rose-100)] text-[18px] text-[var(--color-rose-600)]">
        {count > 99 ? "99+" : count}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-[var(--surface-text)]">
          {title}
        </span>
        <span className="mt-0.5 block text-[12.5px] text-[var(--surface-text-muted)]">
          {description}
        </span>
      </span>
      <span className="shrink-0 text-[13px] text-[var(--color-rose-600)] group-hover:underline">
        {action} →
      </span>
    </Link>
  );
}

/** 처음 온 주선자의 순서. 끝난 단계는 체크로 바꿔 남은 것만 눈에 띄게 한다. */
function StartSteps({ kpi }: { kpi: Kpi }) {
  const steps = [
    {
      done: kpi.telegramLinked,
      title: "텔레그램 봇 연결 (선택)",
      description: "카카오톡에서 받은 프로필을 볼사람을 열지 않고 바로 보냅니다.",
      href: "/account",
      action: "연결",
    },
    {
      done: kpi.myProfiles > 0,
      title: "첫 멤버 등록",
      description: "카카오톡에서 받은 사진과 글을 올리면 AI가 항목을 채웁니다.",
      href: "/imports",
      action: "가져오기",
    },
    {
      done: kpi.invited,
      title: "초대 링크 보내기",
      description: "등록한 분에게 링크를 보내면 그 링크로 멤버 화면에 들어옵니다.",
      href: "/invites",
      action: "초대",
    },
  ];
  // 다음에 할 단계 하나만 버튼으로 강조한다.
  const next = steps.findIndex((step) => !step.done);

  return (
    <Panel
      title="시작하기"
      className="mb-6"
      action={
        <Link
          href="/guide"
          className="text-[12.5px] text-[var(--color-rose-600)] hover:underline"
        >
          화면 사진으로 보기
        </Link>
      }
    >
      <ol className="flex flex-col gap-2.5">
        {steps.map((step, index) => (
          <li key={step.href}>
            <Link
              href={step.href}
              className={cn(
                "flex items-center gap-3.5 rounded-[12px] border px-4 py-3 transition-colors duration-[var(--duration-quick)]",
                index === next
                  ? "border-[var(--color-rose-300)] bg-[var(--color-rose-100)]/50 hover:border-[var(--color-rose-400)]"
                  : "border-[var(--surface-border)] hover:border-[var(--color-rose-300)]",
              )}
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full text-[12.5px] font-medium",
                  step.done
                    ? "bg-[var(--color-rose-600)] text-white"
                    : "border border-[var(--surface-border)] text-[var(--surface-text-muted)]",
                )}
              >
                {step.done ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <path
                      d="m2.5 6.2 2.3 2.3 4.7-5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  index + 1
                )}
                <span className="sr-only">{step.done ? "끝남" : "남음"}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-[14px]",
                    step.done
                      ? "text-[var(--surface-text-muted)] line-through decoration-[var(--surface-border)]"
                      : "font-medium text-[var(--surface-text)]",
                  )}
                >
                  {step.title}
                </span>
                {step.done ? null : (
                  <span className="mt-0.5 block text-[12.5px] text-[var(--surface-text-muted)]">
                    {step.description}
                  </span>
                )}
              </span>
              {index === next ? (
                <span className="shrink-0 rounded-full bg-[var(--color-rose-600)] px-3.5 py-1.5 text-[12.5px] font-medium text-white">
                  {step.action}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function Party({ party }: { party: PartyView | null }) {
  if (!party) {
    return (
      <span className="flex items-center gap-2 text-[13px] text-[var(--surface-text-muted)]">
        <Thumb url={undefined} size="sm" />
        삭제됨
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Thumb
        url={party.url}
        profileId={party.id}
        size="sm"
        label={`${party.code} 사진 크게 보기`}
      />
      <Link href={`/profiles/${party.id}`} className="min-w-0 hover:opacity-80">
        <span className="display block text-[14px] text-[var(--surface-text)]">
          {party.name ?? <ProfileCode code={party.code} />}
        </span>
        {party.name ? (
          <span className="block text-[11.5px] text-[var(--surface-text-muted)]">
            <ProfileCode code={party.code} />
          </span>
        ) : null}
      </Link>
    </span>
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
