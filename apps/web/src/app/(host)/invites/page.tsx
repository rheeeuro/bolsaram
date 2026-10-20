/**
 * 초대 — 내가 맡은 분에게 초대 링크를 보내고 들어왔는지 보는 곳 (설계문서 §6).
 *
 * 해야 할 일 순서로 가른다 — 아직 안 보냄 → 기한 지남 → 열기를 기다림 → 들어옴.
 * 들어온 분은 할 일이 아니라 결과라 맨 아래에 두고, 누가 언제 다녀갔는지만 보인다.
 */
import Link from "next/link";
import { withRls } from "@bolsaram/db";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { findProfilesByIds } from "@/server/repo/profiles";
import { toCardView } from "@/server/views/profile-view";
import { Blank, Count, PageHeader, Panel, RowList, Thumb } from "@/components/host/surface";
import { InviteRow } from "@/components/host/invite-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { ProfileCode } from "@/components/ui/marks";
import { formatDay } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** 정렬 순서이기도 하다. 숫자가 작을수록 먼저 손이 가야 한다. */
type Stage = "unsent" | "expired" | "pending" | "joined";

type InviteListRow = {
  profile_id: string;
  public_code: number;
  real_name: string | null;
  invite_expires_at: Date | null;
  invite_claimed_at: Date | null;
  stage: Stage;
  phone: string | null;
  last_login_at: Date | null;
};

type Entry = InviteListRow & { imageUrl: string | null };

const PAGE_SIZE = 50;

const TODO_STAGES: { stage: Exclude<Stage, "joined">; title: string }[] = [
  { stage: "unsent", title: "아직 보내지 않은 분" },
  // 열지 않고 기한이 지났거나, 링크는 쓰였는데 계정이 이어지지 않은 드문 경우.
  // 어느 쪽이든 새로 발급해 다시 보내야 한다.
  { stage: "expired", title: "다시 보내야 하는 분" },
  { stage: "pending", title: "열기를 기다리는 분" },
];

export default async function HostInvitesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminPage();
  const raw = await searchParams;
  const q = (typeof raw.q === "string" ? raw.q : "").trim().slice(0, 100);
  const parsedPage = Number(typeof raw.page === "string" ? raw.page : "1");
  const requestedPage = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const numberQuery = q.replace(/[^0-9]/g, "");

  const listing = await withRls(rlsContextOf(viewer), async (sql) => {
    // 지금 보고 있는 채널의 담당분만 본다. 볼 수 있는 범위는 RLS 가 이미 정했고,
    // 초대 발급은 편집 권한을 요구하므로(`invites_admin`) 담당이 아닌 줄은 쓸모가 없다.
    // 단계는 최근 초대 한 건으로 정한다 — 새로 발급하면 이전 것은 취소된다.
    const base = `
      WITH scoped AS (
        SELECT p.id AS profile_id, p.public_code, p.real_name, p.created_at,
               u.phone, u.last_login_at,
               i.expires_at AS invite_expires_at, i.claimed_at AS invite_claimed_at,
               CASE
                 WHEN p.user_id IS NOT NULL THEN 'joined'
                 WHEN i.expires_at IS NULL THEN 'unsent'
                 WHEN i.claimed_at IS NOT NULL OR i.expires_at < now() THEN 'expired'
                 ELSE 'pending'
               END AS stage
          FROM profiles p
          LEFT JOIN users u ON u.id = p.user_id
          LEFT JOIN LATERAL (
            SELECT expires_at, claimed_at FROM invites
             WHERE profile_id = p.id AND revoked_at IS NULL
             ORDER BY created_at DESC LIMIT 1
          ) i ON true
         WHERE p.group_id IS NOT DISTINCT FROM $1
           AND app_can_edit_profile(p.id)
           AND (
             $2::text = ''
             OR p.real_name ILIKE '%' || $2 || '%'
             OR ($3::text <> '' AND (
               p.public_code::text = $3
               OR regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') LIKE '%' || $3 || '%'
             ))
           )
      )`;

    const counts = await sql.query<{ stage: Stage; n: number }>(
      `${base} SELECT stage, count(*)::int AS n FROM scoped GROUP BY stage`,
      [viewer.groupId, q, numberQuery],
    );
    const byStage = new Map(counts.rows.map((r) => [r.stage, r.n]));
    const total = counts.rows.reduce((sum, r) => sum + r.n, 0);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(requestedPage, totalPages);

    const result = await sql.query<InviteListRow>(
      `${base}
      SELECT profile_id, public_code, real_name, invite_expires_at, invite_claimed_at, stage,
             phone, last_login_at
        FROM scoped
       ORDER BY CASE stage WHEN 'unsent' THEN 0 WHEN 'expired' THEN 1
                           WHEN 'pending' THEN 2 ELSE 3 END,
                created_at DESC
       LIMIT $4 OFFSET $5`,
      [viewer.groupId, q, numberQuery, PAGE_SIZE, (page - 1) * PAGE_SIZE],
    );

    // 사진은 목록에서 사람을 알아보는 유일한 단서다 — 이름은 여기서만 보인다.
    const profiles = await findProfilesByIds(
      sql,
      result.rows.map((r) => r.profile_id),
    );
    const imageById = new Map(
      profiles.map((p) => [p.id, toCardView(p).primaryImage?.url ?? null]),
    );

    return {
      rows: result.rows.map<Entry>((row) => ({
        ...row,
        imageUrl: imageById.get(row.profile_id) ?? null,
      })),
      byStage,
      total,
      page,
      totalPages,
    };
  });

  const joined = listing.rows.filter((r) => r.stage === "joined");

  function pageHref(page: number): string {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (page > 1) search.set("page", String(page));
    const query = search.toString();
    return query ? `/invites?${query}` : "/invites";
  }

  return (
    <>
      <PageHeader
        title="초대"
        description="멤버는 초대 링크로만 들어옵니다. 아이디·비밀번호가 없습니다."
        aside={<Count>{listing.total}명</Count>}
      />

      <form action="/invites" className="mb-5 flex flex-wrap items-center gap-2">
        <Input
          name="q"
          defaultValue={q}
          placeholder="이름 · #번호 · 전화번호로 찾기"
          className="h-10 w-full sm:w-80"
        />
        <Button type="submit" variant="secondary">
          찾기
        </Button>
        {q ? (
          <Link
            href="/invites"
            className="px-2 py-2 text-[13px] text-[var(--surface-text-muted)] underline"
          >
            검색 초기화
          </Link>
        ) : null}
      </form>

      {listing.total === 0 ? (
        <Panel>
          <Blank>
            {q
              ? "검색 조건에 맞는 분이 없습니다."
              : "아직 등록된 멤버가 없습니다. 「가져오기」에서 첫 멤버를 등록해 보세요."}
          </Blank>
        </Panel>
      ) : (
        <div className="flex flex-col gap-5">
          {/* 할 일이 하나도 없으면 그 사실부터 알린다 — 들어온 분 목록만 덩그러니 남지 않게. */}
          {!q && listing.total === (listing.byStage.get("joined") ?? 0) ? (
            <Panel>
              <Blank>보낼 초대가 없습니다. 맡은 분이 모두 들어왔습니다.</Blank>
            </Panel>
          ) : null}

          {TODO_STAGES.map(({ stage, title }) => {
            const rows = listing.rows.filter((r) => r.stage === stage);
            if (rows.length === 0) return null;
            return (
              <Panel
                key={stage}
                title={title}
                action={<Count>{listing.byStage.get(stage) ?? 0}명</Count>}
                className="overflow-hidden"
              >
                <div className="-mx-5 -my-5">
                  <RowList>
                    {rows.map((row) => (
                      <InviteRow
                        key={row.profile_id}
                        profileId={row.profile_id}
                        code={row.public_code}
                        name={row.real_name}
                        imageUrl={row.imageUrl}
                        expiresAt={row.invite_expires_at?.toISOString() ?? null}
                        claimedAt={row.invite_claimed_at?.toISOString() ?? null}
                      />
                    ))}
                  </RowList>
                </div>
              </Panel>
            );
          })}

          {joined.length > 0 ? (
            <Panel
              title="들어온 분"
              action={<Count>{listing.byStage.get("joined") ?? 0}명</Count>}
              className="overflow-hidden"
            >
              <div className="-mx-5 -my-5">
                <RowList>
                  {joined.map((row) => (
                    // 사진은 크게 보기라 링크 밖에 두고, 나머지 줄 전체가 상세로 간다.
                    <li
                      key={row.profile_id}
                      className="flex items-center gap-4 pl-5 transition-colors duration-[var(--duration-quick)] hover:bg-[var(--surface-muted)]"
                    >
                      <Thumb url={row.imageUrl} size="sm" />
                      <Link
                        href={`/profiles/${row.profile_id}`}
                        className="flex min-w-0 flex-1 items-center gap-4 py-3.5 pr-5"
                      >
                        <Identity code={row.public_code} name={row.real_name} />
                        <div className="ml-auto flex items-center gap-3 text-[12.5px] text-[var(--surface-text-muted)]">
                          {row.phone ? (
                            <span className="hidden sm:inline">{maskPhone(row.phone)}</span>
                          ) : null}
                          <span>
                            {row.last_login_at
                              ? `${formatDay(row.last_login_at.toISOString())} 방문`
                              : "방문 전"}
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </RowList>
              </div>
            </Panel>
          ) : null}

          {listing.totalPages > 1 ? (
            <nav
              aria-label="초대 목록 페이지"
              className="flex items-center justify-center gap-3"
            >
              {listing.page > 1 ? (
                <Link
                  href={pageHref(listing.page - 1)}
                  className="rounded-[var(--radius-pill)] border border-[var(--surface-border)] bg-[var(--surface-card)] px-4 py-2 text-[13px] text-[var(--surface-text-muted)]"
                >
                  이전
                </Link>
              ) : null}
              <span className="text-[13px] text-[var(--surface-text-muted)]">
                {listing.page} / {listing.totalPages}
              </span>
              {listing.page < listing.totalPages ? (
                <Link
                  href={pageHref(listing.page + 1)}
                  className="rounded-[var(--radius-pill)] border border-[var(--surface-border)] bg-[var(--surface-card)] px-4 py-2 text-[13px] text-[var(--surface-text-muted)]"
                >
                  다음
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      )}
    </>
  );
}

function Identity({ code, name }: { code: number; name: string | null }) {
  return (
    <div className="min-w-0">
      <p className="display text-[15px] text-[var(--surface-text)]">
        <ProfileCode code={`${code}번`} />
      </p>
      <p className="truncate text-[12.5px] text-[var(--surface-text-muted)]">
        {name ?? "이름 없음"}
      </p>
    </div>
  );
}

/** 주선자 화면에서도 전화번호를 온전히 노출하지 않는다(설계문서 §12). */
function maskPhone(phone: string): string {
  if (phone.length < 8) return "***";
  return `${phone.slice(0, 3)}-****-${phone.slice(-4)}`;
}
