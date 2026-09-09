/** 프로필 목록 — 검색/필터/상태 관리 (설계문서 §6). */
import Link from "next/link";
import { withRls } from "@bolsaram/db";
import { adminProfileQuerySchema, PROFILE_STATUSES } from "@bolsaram/schemas";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { Badge, toneForStatus } from "@/components/ui/badge";
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
    const result = await findAdminProfiles(sql, query);
    return {
      total: result.total,
      items: result.items.map((profile) => ({
        view: toDetailView(profile, "ADMIN"),
        claimed: profile.userId != null,
      })),
    };
  });

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
          {page.items.map(({ view, claimed }) => (
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
                    <div className="flex h-full items-center justify-center text-[12px] text-[var(--color-ink-400)]">
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
                    <Badge tone={toneForStatus(view.status ?? "")}>
                      {label.visibility(view.visibility)}
                    </Badge>
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
