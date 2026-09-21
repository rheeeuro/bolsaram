/** 프로필 목록 — 검색/필터/상태 관리 (설계문서 §6). */
import type { ReactNode } from "react";
import Link from "next/link";
import { withRls } from "@bolsaram/db";
import { isDiscoverable } from "@bolsaram/domain";
import { adminProfileQuerySchema, PROFILE_STATUSES } from "@bolsaram/schemas";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { Badge } from "@/components/ui/badge";
import { ProfileCode } from "@/components/ui/marks";
import { Count, PageHeader, Panel } from "@/components/host/surface";
import { introducedWithManaged } from "@/server/repo/matches";
import { canEditProfiles, findAdminProfiles } from "@/server/repo/profiles";
import { sourceTextsFor } from "@/server/repo/imports";
import { disclosureFor, toDetailView } from "@/server/views/profile-view";
import { label } from "@/lib/labels";
import { HostProfileFilters } from "@/components/host/profile-filters";
import { ProfileRawList, type RawListItem } from "@/components/host/profile-raw-list";
import { cn } from "@/lib/cn";

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
  // 보기 모드는 필터가 아니라 화면의 것이라 조회 스키마에 넣지 않는다.
  // 값이 이상하면 카드로 떨어뜨린다 — 목록이 안 뜨는 것보다 낫다.
  const mode = raw.view === "raw" ? "raw" : "card";

  const page = await withRls(rlsContextOf(viewer), async (sql) => {
    const result = await findAdminProfiles(sql, query, { groupId: viewer.groupId });
    // 전체공개 풀에는 남이 등록한 프로필도 함께 있다. 담당이 아니면 이름·연락처를
    // 가린다 — 판정은 멤버 경로와 같은 함수가 한다.
    const editable = await canEditProfiles(
      sql,
      result.items.map((p) => p.id),
    );
    const introducedWith = await introducedWithManaged(sql);
    // 원본은 볼 때만 읽는다. 카드 보기에는 쓰지 않는 값이고, 프로필 수만큼의
    // 원문을 매번 끌어올 이유가 없다.
    const sources =
      mode === "raw"
        ? await sourceTextsFor(
            sql,
            result.items.map((p) => p.id),
          )
        : null;
    return {
      total: result.total,
      nextCursor: result.nextCursor,
      items: result.items.map((profile) => ({
        view: toDetailView(
          profile,
          disclosureFor({
            profile,
            viewerRole: "ADMIN",
            viewerUserId: viewer.userId,
            introducedWith,
            canEdit: editable.has(profile.id),
          }),
        ),
        claimed: profile.userId != null,
        // 운영 상태는 개인정보가 아니라 담당이 아니어도 보인다. 공개 단계가 낮아지면
        // view 에서 빠지므로 레코드에서 직접 싣는다.
        status: profile.status,
        // 상태와 노출은 직교한다 — 「공개」인데 안 보이는 조합이 있으므로
        // 두 값을 따로 읽게 두지 않고 결론을 낸다.
        visible: isDiscoverable({ status: profile.status, visibility: profile.visibility }),
        source: sources?.get(profile.id) ?? null,
      })),
    };
  });

  /** 지금 조건을 유지한 채 보기만 바꾼 주소. 커서는 버린다 — 보기를 바꾸면 처음부터 본다. */
  function viewHref(next: "card" | "raw"): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) {
      if (key === "cursor" || key === "view") continue;
      if (typeof value === "string") search.set(key, value);
    }
    if (next === "raw") search.set("view", "raw");
    const qs = search.toString();
    return qs ? `/profiles?${qs}` : "/profiles";
  }

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
        description="등록한 분들입니다. 카드를 누르면 상세가 열리고, 내가 등록한 분은 거기서 공개 여부를 정하거나 내용을 고칩니다."
        aside={<Count>{page.total}명</Count>}
      />

      <HostProfileFilters statuses={[...PROFILE_STATUSES]} />

      {/* 정리된 카드로 볼지, 카카오톡에서 받은 그대로 볼지. 필터는 양쪽에 그대로 걸린다. */}
      <div className="mt-3 flex items-center gap-1.5">
        <ViewTab href={viewHref("card")} active={mode === "card"}>
          카드
        </ViewTab>
        <ViewTab href={viewHref("raw")} active={mode === "raw"}>
          원본
        </ViewTab>
        {mode === "raw" ? (
          <p className="ml-1 text-[12px] text-[var(--surface-text-muted)]">
            가져올 때 받은 사진과 글 그대로입니다.
          </p>
        ) : null}
      </div>

      {page.items.length === 0 ? (
        <Panel className="mt-5">
          <p className="py-12 text-center text-[13.5px] text-[var(--surface-text-muted)]">
            조건에 맞는 프로필이 없습니다.
          </p>
        </Panel>
      ) : mode === "raw" ? (
        <ProfileRawList items={page.items.map(toRawItem)} />
      ) : (
        <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">
          {page.items.map(({ view, claimed, visible, status }) => (
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
                    {label.profileStatus(status)}
                  </span>
                  {!claimed ? (
                    <span className="absolute right-2.5 top-2.5 rounded-[var(--radius-pill)] bg-[var(--color-burgundy-800)]/85 px-2.5 py-1 text-[11.5px] text-white">
                      초대 전
                    </span>
                  ) : null}
                </div>

                <div className="mt-2.5">
                  <p className="display text-[15px] text-[var(--color-ink-900)]">
                    <ProfileCode code={view.code} />
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
                      {visible ? "멤버에게 보임" : "멤버에게 안 보임"}
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

/** 보기 전환 알약. 필터 알약과 같은 모양을 쓴다 — 같은 줄에서 같은 일을 한다. */
function ViewTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-[var(--radius-pill)] border px-3.5 py-1.5 text-[13px]",
        "transition-colors duration-[var(--duration-quick)]",
        active
          ? "border-[var(--color-rose-600)] bg-[var(--color-rose-600)] text-white"
          : "border-[var(--surface-border)] bg-[var(--surface-card)] text-[var(--surface-text-muted)] hover:border-[var(--color-rose-300)]",
      )}
    >
      {children}
    </Link>
  );
}

/**
 * 목록 항목을 원본 보기의 한 줄로 옮긴다.
 * 사진은 공개 단계가 이미 걸러 준 것만 쓴다 — 담당이 아닌 프로필은 대표 한 장이다.
 */
function toRawItem(item: {
  view: { id: string; code: string; gender: string; age: number; images?: { id: string; url: string }[]; primaryImage: { id: string; url: string } | null };
  claimed: boolean;
  visible: boolean;
  status: string;
  source: { source: string; rawText: string | null; committedAt: Date | null } | null;
}): RawListItem {
  const images = item.view.images ?? (item.view.primaryImage ? [item.view.primaryImage] : []);
  return {
    id: item.view.id,
    code: item.view.code,
    gender: item.view.gender,
    age: item.view.age,
    status: item.status,
    visible: item.visible,
    claimed: item.claimed,
    images: images.map((image) => ({ id: image.id, url: image.url })),
    rawText: item.source?.rawText ?? null,
    source: item.source?.source ?? null,
    at: item.source?.committedAt?.toISOString() ?? null,
  };
}
