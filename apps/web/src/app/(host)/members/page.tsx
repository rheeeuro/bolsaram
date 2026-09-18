/** 멤버 — 초대/가입/Claim 현황 (설계문서 §6). */
import Link from "next/link";
import { withRls } from "@bolsaram/db";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { findProfilesByIds } from "@/server/repo/profiles";
import { toCardView } from "@/server/views/profile-view";
import { Blank, Count, PageHeader, Panel, Row, RowList, Thumb } from "@/components/host/surface";
import { InviteRow } from "@/components/host/invite-row";
import { Button } from "@/components/ui/button";
import { ProfileCode } from "@/components/ui/marks";
import { Input } from "@/components/ui/field";

export const dynamic = "force-dynamic";

type MemberRow = {
  user_id: string | null;
  phone: string | null;
  last_login_at: Date | null;
  profile_id: string;
  public_code: number;
  real_name: string | null;
  invite_expires_at: Date | null;
  invite_claimed_at: Date | null;
};

type Entry = MemberRow & { imageUrl: string | null };

const PAGE_SIZE = 50;

export default async function HostMembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminPage();
  const raw = await searchParams;
  const q = (typeof raw.q === "string" ? raw.q : "").trim().slice(0, 100);
  const parsedPage = Number(typeof raw.page === "string" ? raw.page : "1");
  const requestedPage =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const numberQuery = q.replace(/[^0-9]/g, "");

  const listing = await withRls(rlsContextOf(viewer), async (sql) => {
    const counts = await sql.query<{ total: number; waiting: number; joined: number }>(
      `
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE p.user_id IS NULL)::int AS waiting,
             count(*) FILTER (WHERE p.user_id IS NOT NULL)::int AS joined
        FROM profiles p
        LEFT JOIN users u ON u.id = p.user_id
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
      `,
      [viewer.groupId, q, numberQuery],
    );
    const count = counts.rows[0] ?? { total: 0, waiting: 0, joined: 0 };
    const totalPages = Math.max(1, Math.ceil(count.total / PAGE_SIZE));
    const page = Math.min(requestedPage, totalPages);

    const result = await sql.query<MemberRow>(
      // 지금 보고 있는 채널의 멤버만 본다. 볼 수 있는 범위는 RLS 가 이미 정했고
      // 여기서 좁히는 것은 「지금 이 모임」이라는 화면의 약속이다.
      //
      // 담당분만 남긴다. 이 화면은 초대를 발급하고 연결 현황을 보는 곳인데 그 동작은
      // 모두 편집 권한을 요구하고(`invites_admin`), 이름·전화번호를 함께 싣는다.
      `
      SELECT u.id AS user_id, u.phone, u.last_login_at,
             p.id AS profile_id, p.public_code, p.real_name,
             i.expires_at AS invite_expires_at, i.claimed_at AS invite_claimed_at
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
       ORDER BY (p.user_id IS NOT NULL), p.created_at DESC
       LIMIT $4 OFFSET $5
    `,
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
      total: count.total,
      waitingTotal: count.waiting,
      joinedTotal: count.joined,
      page,
      totalPages,
    };
  });

  const rows = listing.rows;
  const waiting = rows.filter((r) => r.user_id == null);
  const joined = rows.filter((r) => r.user_id != null);

  function pageHref(page: number): string {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (page > 1) search.set("page", String(page));
    const query = search.toString();
    return query ? `/members?${query}` : "/members";
  }

  return (
    <>
      <PageHeader
        title="멤버"
        description="등록한 분에게 초대 링크를 보내면 그 링크로 들어옵니다. 아이디와 비밀번호는 없습니다."
        aside={<Count>{listing.total}명</Count>}
      />

      <form action="/members" className="mb-5 flex flex-wrap items-center gap-2">
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
            href="/members"
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
              ? "검색 조건에 맞는 멤버가 없습니다."
              : "아직 등록된 프로필이 없습니다. 「가져오기」에서 첫 프로필을 만들어 보세요."}
          </Blank>
        </Panel>
      ) : (
        <div className="flex flex-col gap-5">
          {waiting.length > 0 ? (
            <Panel
              title="초대를 기다리는 분"
              action={<Count>{listing.waitingTotal}명</Count>}
              className="overflow-hidden"
            >
              <div className="-mx-5 -my-5">
                <RowList>
                  {waiting.map((row) => (
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
          ) : null}

          {joined.length > 0 ? (
            <Panel
              title="들어온 분"
              action={<Count>{listing.joinedTotal}명</Count>}
              className="overflow-hidden"
            >
              <div className="-mx-5 -my-5">
                <RowList>
                  {joined.map((row) => (
                    <Row key={row.profile_id} href={`/profiles/${row.profile_id}`}>
                      <Thumb url={row.imageUrl} size="sm" />
                      <Identity code={row.public_code} name={row.real_name} />
                      <div className="ml-auto flex items-center gap-3 text-[12.5px] text-[var(--surface-text-muted)]">
                        <span className="hidden sm:inline">{maskPhone(row.phone)}</span>
                        <span>
                          {row.last_login_at
                            ? `${row.last_login_at.toLocaleDateString("ko-KR")} 방문`
                            : "방문 전"}
                        </span>
                      </div>
                    </Row>
                  ))}
                </RowList>
              </div>
            </Panel>
          ) : null}

          {listing.totalPages > 1 ? (
            <nav aria-label="멤버 목록 페이지" className="flex items-center justify-center gap-3">
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
function maskPhone(phone: string | null): string {
  if (!phone) return "—";
  if (phone.length < 8) return "***";
  return `${phone.slice(0, 3)}-****-${phone.slice(-4)}`;
}
