/** 프로필 목록 — 검색/필터/상태 관리 (설계문서 §6). */
import type { ReactNode } from "react";
import Link from "next/link";
import { withRls } from "@bolsaram/db";
import { adminProfileQuerySchema, PROFILE_STATUSES } from "@bolsaram/schemas";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { buttonClasses } from "@/components/ui/button";
import { Count, PageHeader, Panel } from "@/components/host/surface";
import { loadHostProfilePage } from "@/server/views/host-profile-list";
import { HostProfileFilters } from "@/components/host/profile-filters";
import { HostProfileList } from "@/components/host/profile-list";
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

  // 첫 화면은 늘 처음부터 그린다. 다음 페이지는 스크롤이 끝에 닿을 때 목록이 이어 붙인다 —
  // 옛 주소에 남은 커서는 쓰지 않는다.
  const page = await withRls(rlsContextOf(viewer), (sql) =>
    loadHostProfilePage(sql, viewer, { ...query, cursor: undefined }, mode),
  );

  /** 지금 조건(커서·보기 제외). 보기 전환 주소와 다음 페이지 요청이 함께 쓴다. */
  const listQuery = (() => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) {
      if (key === "cursor" || key === "view") continue;
      if (typeof value === "string") search.set(key, value);
    }
    return search.toString();
  })();

  /** 지금 조건을 유지한 채 보기만 바꾼 주소. 보기를 바꾸면 처음부터 본다. */
  function viewHref(next: "card" | "raw"): string {
    const search = new URLSearchParams(listQuery);
    if (next === "raw") search.set("view", "raw");
    const qs = search.toString();
    return qs ? `/profiles?${qs}` : "/profiles";
  }

  return (
    <>
      <PageHeader
        title="멤버"
        description="내가 등록한 분은 카드를 눌러 공개 여부를 정하고 내용을 고칩니다."
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

      {/* 아무도 없는 채널에서는 거를 것이 없다 — 조작 줄을 걷고 할 일(가져오기)만 남긴다. */}
      {page.total === 0 && !filtered ? null : (
        <>
      <HostProfileFilters statuses={[...PROFILE_STATUSES]} />

      {/* 정리된 카드로 볼지, 카카오톡에서 받은 그대로 볼지. 필터는 양쪽에 그대로 걸린다.
          필터 칩과 헷갈리지 않게 밑줄 탭으로 그린다. */}
      <div className="mt-4 flex items-end gap-5 border-b border-[var(--surface-border)]">
        <ViewTab href={viewHref("card")} active={mode === "card"}>
          카드로 보기
        </ViewTab>
        <ViewTab href={viewHref("raw")} active={mode === "raw"}>
          받은 원본
        </ViewTab>
        {mode === "raw" ? (
          <p className="hidden pb-2 text-[12px] text-[var(--surface-text-muted)] sm:block">
            가져올 때 받은 사진과 글 그대로입니다.
          </p>
        ) : null}
      </div>
        </>
      )}

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
                여기에는 아직 등록한 멤버가 없습니다.
              </p>
              <Link href="/imports" className={buttonClasses({ variant: "secondary" })}>
                카카오톡 프로필 가져오기
              </Link>
            </div>
          )}
        </Panel>
      ) : (
        // 조건·보기가 바뀌면 처음부터 다시 쌓는다 — 이어 붙인 페이지는 이전 조건의 것이다.
        <HostProfileList
          key={`${mode}?${listQuery}`}
          initial={page}
          query={listQuery}
        />
      )}
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
        "-mb-px border-b-2 pb-2 pt-1 text-[13.5px]",
        "transition-colors duration-[var(--duration-quick)]",
        active
          ? "border-[var(--color-rose-600)] font-medium text-[var(--surface-text)]"
          : "border-transparent text-[var(--surface-text-muted)] hover:text-[var(--surface-text)]",
      )}
    >
      {children}
    </Link>
  );
}
