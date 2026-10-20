"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { normalizeHashtags } from "@bolsaram/schemas";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { AiRecommendBadge, HashtagChip } from "@/components/ui/marks";
import { ProfileCard } from "@/components/member/profile-card";
import { ProfileRow } from "@/components/member/profile-row";
import { ProfileRawRow } from "@/components/member/profile-raw-row";
import { FilterSheet } from "@/components/member/filter-sheet";
import { MemberSubBar } from "@/components/member/member-header";
import {
  CardGridSkeleton,
  CardRowsSkeleton,
  RawRowsSkeleton,
} from "@/components/member/card-grid-skeleton";
import { LoadingLabel } from "@/components/ui/skeleton";
import { LoadMore } from "@/components/ui/load-more";
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  filtersToParams,
  type Filters,
} from "@/components/member/filter-model";
import { apiGet } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { ProfileCardView, ProfileRawView } from "@/server/views/profile-view";

type Page<T> = { items: T[]; nextCursor: string | null; total: number };

/**
 * 받은 목록. 원본 보기는 사진 전체와 글을 함께 받으므로 응답 모양이 다르다 —
 * 어느 쪽으로 받았는지를 같이 들고 있어야 보기를 바꾼 직후 엉뚱한 줄을 그리지 않는다.
 */
type Loaded = { raw: false; items: ProfileCardView[] } | { raw: true; items: ProfileRawView[] };

/**
 * 사진 격자 · 한 줄 목록 · 원본(사진 묶음과 글을 나란히).
 * 앞의 둘은 같은 응답을 다르게 그리고, 원본만 서버에 다른 응답을 받는다.
 */
type ViewMode = "list" | "grid" | "raw";
const VIEW_KEY = "bolsaram.discover.view";

export function DiscoverClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 해시태그만 주소에 담는다 — 프로필 상세의 태그를 눌러 들어오는 경로가 있어서다.
  const [filters, setFilters] = useState<Filters>(() => ({
    ...DEFAULT_FILTERS,
    tags: normalizeHashtags((searchParams.get("tags") ?? "").split(",")),
  }));
  // 「AI 추천만」. 나이·지역 같은 조건과 성격이 달라(서버가 내 이상형으로 고른다) 필터
  // 시트가 아니라 위 막대에 따로 둔다 — 한 번 눌러 켜고 끄는 것이 자연스럽다.
  const [aiOnly, setAiOnly] = useState(() => searchParams.get("ai") === "1");
  const [sheetOpen, setSheetOpen] = useState(false);
  // 소개팅은 사진이 먼저다 — 들어올 때는 늘 사진을 크게 깐다. 고른 방식은 같은 탭 안에서만
  // 기억한다(상세에서 돌아와도 유지). 기기에 남기면 한 번 고른 목록이 기본처럼 굳는다.
  const [view, setView] = useState<ViewMode>("grid");

  // 저장된 보기를 읽기 전에는 불러오지 않는다 — 원본 보기로 열 사람에게 카드부터 받아 오면 한 번 버린다.
  const [viewReady, setViewReady] = useState(false);
  const raw = view === "raw";

  const [loaded, setLoaded] = useState<Loaded>({ raw: false, items: [] });
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 이어 불러오기 실패는 이미 받은 목록을 지우지 않고 목록 아래에만 알린다.
  const [moreError, setMoreError] = useState<string | null>(null);
  // 조건이 바뀐 뒤 늦게 도착한 이전 응답이 새 목록을 덮지 못하게 한다.
  const loadGeneration = useRef(0);

  const load = useCallback(
    async (nextCursor: string | null, replace: boolean) => {
      const generation = replace ? ++loadGeneration.current : loadGeneration.current;
      const params = filtersToParams(filters);
      if (aiOnly) params.set("ai", "1");
      if (raw) params.set("view", "raw");
      if (nextCursor) params.set("cursor", nextCursor);
      const result = await apiGet<Page<ProfileCardView | ProfileRawView>>(
        `/api/profiles?${params.toString()}`,
      );
      if (generation !== loadGeneration.current) return;
      if (!result.ok) {
        if (replace) {
          setError(result.message);
          // 이 보기의 응답을 받은 것으로 둔다 — 그러지 않으면 원본 보기가 기다림에서 못 나온다.
          setLoaded(raw ? { raw: true, items: [] } : { raw: false, items: [] });
        } else setMoreError(result.message);
        return;
      }
      setError(null);
      setMoreError(null);
      setTotal(result.data.total);
      setCursor(result.data.nextCursor);
      const items = result.data.items;
      setLoaded((prev) => {
        const kept = replace ? [] : prev.items;
        return raw
          ? { raw: true, items: [...(kept as ProfileRawView[]), ...(items as ProfileRawView[])] }
          : { raw: false, items: [...kept, ...items] };
      });
    },
    [filters, aiOnly, raw],
  );

  // 저장된 보기 방식은 mount 뒤에 읽는다 — 서버 렌더 결과와 어긋나면 hydration 이 깨진다.
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(VIEW_KEY);
      if (stored === "list" || stored === "grid" || stored === "raw") setView(stored);
    } catch {
      // 저장소를 막아둔 브라우저에서는 기본값으로 둔다.
    }
    setViewReady(true);
  }, []);

  function changeView(next: ViewMode): void {
    setView(next);
    try {
      window.sessionStorage.setItem(VIEW_KEY, next);
    } catch {
      // 기억하지 못할 뿐 보기 전환은 된다.
    }
  }

  // 태그와 「AI 추천만」이 바뀌면 주소도 따라간다 — 상세에서 뒤로 왔을 때 같은 목록이어야 한다.
  // 뒤로 가기 이력을 남기지 않으려고 replace 를 쓴다.
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.tags.length > 0) params.set("tags", filters.tags.join(","));
    if (aiOnly) params.set("ai", "1");
    const query = params.toString().replace(/%2C/g, ",");
    router.replace(query ? `/discover?${query}` : "/discover", { scroll: false });
  }, [filters.tags, aiOnly, router]);

  // 필터나 원본 보기 여부가 바뀌면 처음부터 다시 읽는다. 목록 ↔ 격자는 같은 응답이라 다시 읽지 않는다.
  useEffect(() => {
    if (!viewReady) return;
    let cancelled = false;
    setLoading(true);
    void load(null, true).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [load, viewReady]);

  const items = loaded.items;
  // 원본으로 바꾼 직후에는 아직 카드 응답을 들고 있다 — 새 응답이 올 때까지 기다린다.
  const showLoading = loading || !viewReady || (raw && !loaded.raw);
  const filterCount = activeFilterCount(filters);

  return (
    <main className="mx-auto max-w-3xl px-4">
      <MemberSubBar>
        {/* 성별 탭은 두지 않는다 — 보이는 사람은 이성뿐이라 고를 것이 없다. */}
        <ViewToggle value={view} onChange={changeView} />

        <button
          type="button"
          aria-pressed={aiOnly}
          onClick={() => setAiOnly((v) => !v)}
          title="내 이상형 조건과 잘 맞는 분만 봅니다"
          className={cn(
            "flex items-center gap-1 rounded-full border px-3 py-1.5 text-[13px] transition-colors",
            aiOnly
              ? "border-[var(--color-rose-500)] bg-[var(--color-rose-100)] text-[var(--color-rose-600)]"
              : "border-[var(--surface-border)] text-[var(--color-ink-700)]",
          )}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M8 1.5l1.4 3.9 3.9 1.4-3.9 1.4L8 12.1 6.6 8.2 2.7 6.8l3.9-1.4L8 1.5zM12.8 10.6l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6.6-1.6z" />
          </svg>
          AI 추천
        </button>

        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors",
            filterCount > 0
              ? "border-[var(--color-rose-500)] text-[var(--color-rose-600)]"
              : "border-[var(--surface-border)] text-[var(--color-ink-700)]",
          )}
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path
              d="M3 5h14M6 10h8M9 15h2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          필터
          {filterCount > 0 ? (
            <span className="grid h-4 min-w-4 place-items-center rounded-full bg-[var(--color-rose-500)] px-1 text-[10px] text-white">
              {filterCount}
            </span>
          ) : null}
        </button>
      </MemberSubBar>

      {filters.tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 pb-3 pt-3">
          {filters.tags.map((tag) => (
            <HashtagChip
              key={tag}
              tag={tag}
              onRemove={() =>
                setFilters((prev) => ({
                  ...prev,
                  tags: prev.tags.filter((t) => t !== tag),
                }))
              }
            />
          ))}
        </div>
      ) : null}

      {showLoading ? (
        <div className="pt-3">
          <LoadingLabel />
          {view === "raw" ? (
            <RawRowsSkeleton />
          ) : view === "list" ? (
            <CardRowsSkeleton />
          ) : (
            <CardGridSkeleton />
          )}
        </div>
      ) : error ? (
        <Empty
          title="목록을 불러오지 못했어요"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load(null, true)}>
              다시 시도
            </Button>
          }
        />
      ) : items.length === 0 && aiOnly ? (
        <Empty
          title="AI 추천에 맞는 분이 아직 없어요"
          description="내 이상형 조건과 잘 맞는 분이 들어오면 여기에 보여 드려요. 이상형이 바뀌었다면 주선자에게 알려 주세요."
          action={
            <Button variant="secondary" onClick={() => setAiOnly(false)}>
              전체 보기
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <Empty
          title="조건에 맞는 분이 없어요"
          description="조건을 조금 넓혀보시면 더 많은 분을 만날 수 있어요."
          action={
            filterCount > 0 ? (
              <Button variant="secondary" onClick={() => setFilters(DEFAULT_FILTERS)}>
                조건 초기화
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <p role="status" className="flex items-center gap-1.5 pb-3 text-[12px] text-[var(--color-ink-600)]">
            {aiOnly ? <AiRecommendBadge /> : null}
            {total}명
          </p>
          {loaded.raw && raw ? (
            <div className="flex flex-col gap-3">
              {loaded.items.map((profile, index) => (
                <ProfileRawRow key={profile.id} profile={profile} index={index} />
              ))}
            </div>
          ) : view === "list" ? (
            <div className="divide-y divide-[var(--surface-border)]">
              {items.map((profile, index) => (
                <ProfileRow key={profile.id} profile={profile} index={index} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((profile, index) => (
                <ProfileCard key={profile.id} profile={profile} index={index} />
              ))}
            </div>
          )}

          <LoadMore
            hasMore={cursor !== null}
            loading={loadingMore}
            error={moreError}
            onLoad={() => {
              if (!cursor || loadingMore) return;
              setLoadingMore(true);
              void load(cursor, false).finally(() => setLoadingMore(false));
            }}
          />
        </>
      )}

      <FilterSheet
        open={sheetOpen}
        initial={filters}
        onClose={() => setSheetOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setSheetOpen(false);
        }}
      />
    </main>
  );
}


/**
 * 사진 격자 · 한 줄 목록 · 원본 전환. 처음 열리는 사진을 맨 앞에 둔다.
 * 사진을 크게 보고 싶은 사람도, 눌러 보지 않고 내용까지 훑고 싶은 사람도 있어서 고르게 둔다.
 */
function ViewToggle({
  value,
  onChange,
  className,
}: {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="보기 방식"
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded-full border border-[var(--surface-border)] bg-white p-0.5",
        className,
      )}
    >
      <ViewToggleButton
        label="사진으로 보기"
        active={value === "grid"}
        onClick={() => onChange("grid")}
      >
        <path
          d="M3.5 3.5h5.5v5.5H3.5zM11 3.5h5.5v5.5H11zM3.5 11h5.5v5.5H3.5zM11 11h5.5v5.5H11z"
          fill="currentColor"
        />
      </ViewToggleButton>
      <ViewToggleButton
        label="목록으로 보기"
        active={value === "list"}
        onClick={() => onChange("list")}
      >
        <path d="M3 6h3v3H3zM3 11.5h3v3H3z" fill="currentColor" />
        <path
          d="M8.5 7.5H17M8.5 13H17"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </ViewToggleButton>
      <ViewToggleButton
        label="원본으로 보기"
        active={value === "raw"}
        onClick={() => onChange("raw")}
      >
        {/* 사진 묶음 옆에 글 — 카카오톡에서 받아 보던 모양. */}
        <path d="M3 4h6v6H3z" fill="currentColor" />
        <path
          d="M11.5 5H17M11.5 8.5H17M3 13.5h14M3 16.5h9"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </ViewToggleButton>
    </div>
  );
}

function ViewToggleButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "grid h-7 w-8 place-items-center rounded-full transition-colors",
        active ? "bg-[var(--color-ink-900)] text-white" : "text-[var(--color-ink-600)]",
      )}
    >
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
        {children}
      </svg>
    </button>
  );
}
