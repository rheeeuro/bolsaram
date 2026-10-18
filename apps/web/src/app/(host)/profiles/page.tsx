/** 프로필 목록 — 검색/필터/상태 관리 (설계문서 §6). */
import type { ReactNode } from "react";
import Link from "next/link";
import { withRls } from "@bolsaram/db";
import { isDiscoverable } from "@bolsaram/domain";
import { adminProfileQuerySchema, PROFILE_STATUSES } from "@bolsaram/schemas";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { buttonClasses } from "@/components/ui/button";
import { ProfileCode } from "@/components/ui/marks";
import { Count, PageHeader, Panel } from "@/components/host/surface";
import { introducedWithManaged } from "@/server/repo/matches";
import { canEditProfiles, findAdminProfiles } from "@/server/repo/profiles";
import { sourceTextsFor } from "@/server/repo/imports";
import { disclosureFor, toDetailView, type ProfileDetailView } from "@/server/views/profile-view";
import { formatDay } from "@/lib/dates";
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
  // 빈 목록이 「조건 때문」인지 「아직 아무도 없어서」인지 가른다. 보기·커서는 조건이 아니다.
  const filtered = Object.entries(raw).some(
    ([key, value]) => key !== "view" && key !== "cursor" && typeof value === "string" && value !== "",
  );

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
        canEdit: editable.has(profile.id),
        // 운영 상태는 개인정보가 아니라 담당이 아니어도 보인다. 공개 단계가 낮아지면
        // view 에서 빠지므로 레코드에서 직접 싣는다.
        status: profile.status,
        // 상태와 노출은 직교한다 — 「공개」인데 안 보이는 조합이 있으므로
        // 두 값을 따로 읽게 두지 않고 결론을 낸다.
        visible: isDiscoverable({ status: profile.status }),
        source: sources?.get(profile.id) ?? null,
        // 등록 시각은 개인정보가 아니라 담당이 아니어도 보인다.
        createdAt: profile.createdAt.toISOString(),
        // 목록은 끌어올린 순서로 선다. 날짜가 순서와 어긋나 보이지 않게 함께 싣는다.
        bumpedAt: profile.bumpedAt?.toISOString() ?? null,
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
        title="멤버"
        description="등록한 분들입니다. 카드를 누르면 상세가 열리고, 내가 등록한 분은 거기서 공개 여부를 정하거나 내용을 고칩니다."
        aside={
          <>
            <Count>{page.total}명</Count>
            {/* 드물게 쓰는 도구라 목록 옆에 조용히 둔다. */}
            <Link
              href="/profiles/trace"
              className="text-[13px] text-[var(--surface-text-muted)] underline-offset-4 hover:text-[var(--color-rose-600)] hover:underline"
            >
              캡처본 확인
            </Link>
          </>
        }
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
          {filtered ? (
            <p className="py-12 text-center text-[13.5px] text-[var(--surface-text-muted)]">
              조건에 맞는 프로필이 없습니다. 조건을 넓혀 보세요.
            </p>
          ) : (
            // 조건 없이 비어 있으면 이 방에 아직 아무도 없는 것이다 — 할 일은 가져오기다.
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-[13.5px] text-[var(--surface-text-muted)]">
                이 방에는 아직 등록한 프로필이 없습니다.
              </p>
              <Link href="/imports" className={buttonClasses({ variant: "secondary" })}>
                카카오톡 프로필 가져오기
              </Link>
            </div>
          )}
        </Panel>
      ) : mode === "raw" ? (
        <ProfileRawList items={page.items.map(toRawItem)} />
      ) : (
        <ul className="stagger mt-5 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">
          {page.items.map(({ view, visible, createdAt, bumpedAt }) => (
            <li key={view.id}>
              <Link href={`/profiles/${view.id}`} className="lift-move group block">
                <div className="lift-shadow relative aspect-3/4 overflow-hidden rounded-[var(--radius-card)] bg-[var(--color-ivory-200)]">
                  {view.primaryImage ? (
                    // signed URL 은 응답마다 새로 발급된다. next/image 최적화를 태우면
                    // URL 이 캐시되어 만료 뒤 깨지므로 img 를 그대로 쓴다.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={view.primaryImage.url}
                      alt=""
                      loading="lazy"
                      className={cn(
                        "h-full w-full object-cover transition-transform duration-[var(--duration-base)] group-hover:scale-[1.02]",
                        // 비활성은 멤버에게 안 보인다 — 훑을 때 배지보다 먼저 눈에 걸리게 흑백으로 둔다.
                        !visible && "grayscale",
                      )}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[12px] text-[var(--color-ink-700)]">
                      사진 없음
                    </div>
                  )}

                  {/* 상태는 둘뿐이고 활성이 평소 모습이다 — 예외인 비활성만 사진 위에 띄운다. */}
                  {!visible ? (
                    <span className="absolute left-2.5 top-2.5 rounded-[var(--radius-pill)] bg-[var(--color-ink-900)]/70 px-2.5 py-1 text-[11.5px] text-white backdrop-blur">
                      비활성 · 멤버에게 안 보임
                    </span>
                  ) : null}
                </div>

                <div className="mt-2.5">
                  {/* 주선자는 번호가 아니라 이름으로 기억한다. 이름은 담당일 때만 온다. */}
                  {view.realName ? (
                    <p className="display truncate text-[15px] text-[var(--color-ink-900)]">
                      {view.realName}
                      <span className="ml-2 font-sans text-[12px] text-[var(--color-ink-500)]">
                        {view.code} · {label.gender(view.gender)}
                      </span>
                    </p>
                  ) : (
                    <p className="display text-[15px] text-[var(--color-ink-900)]">
                      <ProfileCode code={view.code} />
                      <span className="ml-2 font-sans text-[12px] text-[var(--color-ink-500)]">
                        {label.gender(view.gender)}
                      </span>
                    </p>
                  )}
                  <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-700)]">
                    {label.birthYear(view.birthYear)}
                  </p>
                  {/* 키는 출생연도 옆에 두면 먼저 읽힌다. 직업·지역 줄 끝에 작게 붙인다. */}
                  <p className="text-[12.5px] text-[var(--color-ink-600)]">
                    {workLine(view)}
                    {view.height ? (
                      <span className="text-[11.5px] text-[var(--color-ink-500)]">
                        {workLine(view) ? " · " : ""}
                        {view.height}cm
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-[11.5px] text-[var(--color-ink-500)]">
                    {bumpedAt ? (
                      <>
                        <time dateTime={bumpedAt}>{formatDay(bumpedAt)}</time> 끌어올림
                      </>
                    ) : (
                      <>
                        <time dateTime={createdAt}>{formatDay(createdAt)}</time> 등록
                      </>
                    )}
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

/** 카드 셋째 줄. 직함이 있으면 직업군보다 먼저 쓴다. */
function workLine(view: ProfileDetailView): string {
  return [
    view.jobTitle ?? label.jobCategory(view.jobCategory),
    label.region(view.residenceRegion),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * 목록 항목을 원본 보기의 한 줄로 옮긴다.
 * 사진은 공개 단계가 이미 걸러 준 것만 쓴다 — 담당이 아닌 프로필은 대표 한 장이다.
 */
function toRawItem(item: {
  view: ProfileDetailView;
  canEdit: boolean;
  visible: boolean;
  source: { source: string; rawText: string | null; committedAt: Date | null } | null;
}): RawListItem {
  const images = item.view.images ?? (item.view.primaryImage ? [item.view.primaryImage] : []);
  return {
    id: item.view.id,
    code: item.view.code,
    name: item.view.realName ?? null,
    gender: item.view.gender,
    birthYear: item.view.birthYear,
    visible: item.visible,
    images: images.map((image) => ({ id: image.id, url: image.url })),
    rawText: item.source?.rawText ?? null,
    // 가져오기 원본은 올린 주선자만 읽는다(RLS). 같은 모임이어도 남이 올린 건
    // 원문이 오지 않으므로, 「글이 없다」가 아니라 「볼 수 없다」로 안내한다.
    sourceHidden: !item.canEdit,
    summary: summaryText(item.view),
    source: item.source?.source ?? null,
    at: item.source?.committedAt?.toISOString() ?? null,
  };
}

/**
 * 원문이 없을 때 대신 보여줄 줄글. 카카오톡 프로필처럼 「항목: 값」 줄로 쓴다.
 *
 * view 는 공개 단계를 이미 통과한 값이라 담당이 아니면 이름·연락처가 들어 있지 않다 —
 * 그래서 남이 올린 원문을 열지 않고도 같은 내용을 훑을 수 있다. 여기서 더 걸러내지 않는다.
 */
function summaryText(view: ProfileDetailView): string | null {
  const job = [view.jobTitle ?? label.jobCategory(view.jobCategory), view.company]
    .filter(Boolean)
    .join(" · ");
  const lines: [string, string | null][] = [
    ["나이", label.birthYear(view.birthYear)],
    ["키", view.height ? `${view.height}cm` : null],
    ["직업", job || null],
    ["학력", view.education],
    ["사는 곳", label.region(view.residenceRegion)],
    ["직장 지역", label.region(view.workplaceRegion)],
    ["종교", label.religion(view.religion)],
    ["MBTI", view.mbti],
    ["흡연", label.smoking(view.smoking)],
    ["음주", label.drinking(view.drinking)],
    ["취미", view.hobbies.length > 0 ? view.hobbies.join(", ") : null],
    ["이상형", view.idealTypeText],
  ];
  const blocks = [
    lines
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n"),
    view.bio,
    view.hostComment ? `주선자 한마디: ${view.hostComment}` : null,
    view.hashtags.length > 0 ? view.hashtags.map((tag) => `#${tag}`).join(" ") : null,
  ].filter((block): block is string => Boolean(block?.trim()));
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}
