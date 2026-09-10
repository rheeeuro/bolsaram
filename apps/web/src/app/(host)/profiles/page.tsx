/** 프로필 목록 — 검색/필터/상태 관리 (설계문서 §6). */
import Link from "next/link";
import { withRls } from "@bolsaram/db";
import { isDiscoverable } from "@bolsaram/domain";
import { adminProfileQuerySchema, PROFILE_STATUSES } from "@bolsaram/schemas";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { Badge } from "@/components/ui/badge";
import { Count, PageHeader, Panel } from "@/components/host/surface";
import { findAdminProfiles } from "@/server/repo/profiles";
import { toDetailView } from "@/server/views/profile-view";
import { label } from "@/lib/labels";
import { HostProfileFilters } from "@/components/host/profile-filters";

export const dynamic = "force-dynamic";

export default async function HostProfilesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminPage();
  const raw = await searchParams;
  // 잘못된 쿼리로 화면이 죽지 않도록 기본값으로 떨어뜨린다.
  const parsed = adminProfileQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : adminProfileQuerySchema.parse({});

  const page = await withRls(rlsContextOf(viewer), async (sql) => {
    const result = await findAdminProfiles(sql, query, { groupId: viewer.groupId });
    return {
      total: result.total,
      nextCursor: result.nextCursor,
      items: result.items.map((profile) => ({
        view: toDetailView(profile, "ADMIN"),
        claimed: profile.userId != null,
        // 상태와 노출은 직교한다 — 「공개」인데 안 보이는 조합이 있으므로
        // 두 값을 따로 읽게 두지 않고 결론을 낸다.
        visible: isDiscoverable({ status: profile.status, visibility: profile.visibility }),
      })),
    };
  });

  /** 지금 조건을 유지한 채 커서만 바꾼 주소. 필터를 잃지 않고 넘긴다. */
  function pageHref(cursor: string | null): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) {
      if (key === "cursor") continue;
      if (typeof value === "string") search.set(key, value);
    }
    if (cursor) search.set("cursor", cursor);
    const qs = search.toString();
    return qs ? `/profiles?${qs}` : "/profiles";
  }

  return (
    <>
      <PageHeader
        title="프로필"
        description="등록한 분들입니다. 카드를 누르면 내용을 고치고 공개 여부를 정할 수 있습니다."
        aside={<Count>{page.total}명</Count>}
      />

      <HostProfileFilters statuses={[...PROFILE_STATUSES]} />

      {page.items.length === 0 ? (
        <Panel className="mt-5">
          <p className="py-12 text-center text-[13.5px] text-[var(--surface-text-muted)]">
            조건에 맞는 프로필이 없습니다.
          </p>
        </Panel>
      ) : (
        <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">
          {page.items.map(({ view, claimed, visible }) => (
            <li key={view.id}>
              <Link href={`/profiles/${view.id}`} className="group block">
                <div className="relative aspect-3/4 overflow-hidden rounded-[var(--radius-card)] bg-[var(--color-ivory-200)]">
                  {view.primaryImage ? (
                    // signed URL 은 응답마다 새로 발급된다. next/image 최적화를 태우면
                    // URL 이 캐시되어 만료 뒤 깨지므로 img 를 그대로 쓴다.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={view.primaryImage.url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-[var(--duration-base)] group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[12px] text-[var(--color-ink-700)]">
                      사진 없음
                    </div>
                  )}

                  <span className="absolute left-2.5 top-2.5 rounded-[var(--radius-pill)] bg-white/90 px-2.5 py-1 text-[11.5px] font-medium text-[var(--color-ink-800)] backdrop-blur">
                    {label.profileStatus(view.status)}
                  </span>
                  {!claimed ? (
                    <span className="absolute right-2.5 top-2.5 rounded-[var(--radius-pill)] bg-[var(--color-burgundy-800)]/85 px-2.5 py-1 text-[11.5px] text-white">
                      초대 전
                    </span>
                  ) : null}
                </div>

                <div className="mt-2.5">
                  <p className="display text-[15px] text-[var(--color-ink-900)]">
                    {view.code}
                    <span className="ml-2 font-sans text-[12px] text-[var(--color-ink-500)]">
                      {label.gender(view.gender)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-700)]">
                    {view.birthYear}년생{view.height ? ` · ${view.height}cm` : ""}
                  </p>
                  <p className="text-[12.5px] text-[var(--color-ink-600)]">
                    {[
                      view.jobTitle ?? label.jobCategory(view.jobCategory),
                      label.region(view.residenceRegion),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="mt-1.5">
                    {/* 사진 위 칩이 상태를, 여기가 결론을 말한다. */}
                    <Badge tone={visible ? "active" : "neutral"}>
                      {visible ? "회원에게 보임" : "회원에게 안 보임"}
                    </Badge>
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {page.nextCursor || query.cursor ? (
        <div className="mt-7 flex items-center justify-center gap-3">
          {query.cursor ? (
            <Link
              href={pageHref(null)}
              className="rounded-[var(--radius-pill)] border border-[var(--surface-border)] bg-[var(--surface-card)] px-4 py-2 text-[13px] text-[var(--surface-text-muted)] transition-colors hover:border-[var(--color-rose-300)]"
            >
              처음으로
            </Link>
          ) : null}
          {page.nextCursor ? (
            <Link
              href={pageHref(page.nextCursor)}
              className="rounded-[var(--radius-pill)] border border-[var(--color-rose-300)] bg-[var(--surface-card)] px-4 py-2 text-[13px] text-[var(--color-rose-600)] transition-colors hover:bg-[var(--color-rose-100)]"
            >
              다음 {query.limit}명
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
