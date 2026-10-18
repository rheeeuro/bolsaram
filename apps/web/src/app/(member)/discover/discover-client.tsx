"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { normalizeHashtags } from "@bolsaram/schemas";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { AiRecommendBadge, HashtagChip } from "@/components/ui/marks";
import { ProfileCard } from "@/components/member/profile-card";
import { ProfileRow } from "@/components/member/profile-row";
import { FilterSheet } from "@/components/member/filter-sheet";
import { MemberSubBar } from "@/components/member/member-header";
import { CardGridSkeleton, CardRowsSkeleton } from "@/components/member/card-grid-skeleton";
import { LoadingLabel } from "@/components/ui/skeleton";
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  filtersToParams,
  type Filters,
} from "@/components/member/filter-model";
import { apiGet } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { ProfileCardView } from "@/server/views/profile-view";

type Page = { items: ProfileCardView[]; nextCursor: string | null; total: number };

/** 한 줄 목록이 기본이다 — 여러 명을 훑을 때 사진 격자는 하나씩 눌러 봐야 한다. */
type ViewMode = "list" | "grid";
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
  // 소개팅은 사진이 먼저다 — 처음에는 사진을 크게 깐다. 고른 방식은 기기에 남는다.
  const [view, setView] = useState<ViewMode>("grid");

  const [items, setItems] = useState<ProfileCardView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 조건이 바뀐 뒤 늦게 도착한 이전 응답이 새 목록을 덮지 못하게 한다.
  const loadGeneration = useRef(0);

  const load = useCallback(
    async (nextCursor: string | null, replace: boolean) => {
      const generation = replace ? ++loadGeneration.current : loadGeneration.current;
      const params = filtersToParams(filters);
      if (aiOnly) params.set("ai", "1");
      if (nextCursor) params.set("cursor", nextCursor);
      const result = await apiGet<Page>(`/api/profiles?${params.toString()}`);
      if (generation !== loadGeneration.current) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      setTotal(result.data.total);
      setCursor(result.data.nextCursor);
      setItems((prev) => (replace ? result.data.items : [...prev, ...result.data.items]));
    },
    [filters, aiOnly],
  );

  // 저장된 보기 방식은 mount 뒤에 읽는다 — 서버 렌더 결과와 어긋나면 hydration 이 깨진다.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_KEY);
      if (stored === "list" || stored === "grid") setView(stored);
    } catch {
      // 저장소를 막아둔 브라우저에서는 기본값으로 둔다.
    }
  }, []);

  function changeView(next: ViewMode): void {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
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

  // 성별 탭이나 필터가 바뀌면 처음부터 다시 읽는다.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void load(null, true).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

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

      {loading ? (
        <div className="pt-3">
          <LoadingLabel />
          {view === "list" ? <CardRowsSkeleton /> : <CardGridSkeleton />}
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
          {view === "list" ? (
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

          {cursor ? (
            <div className="flex justify-center py-8">
              <Button
                variant="secondary"
                disabled={loadingMore}
                onClick={() => {
                  setLoadingMore(true);
                  void load(cursor, false).finally(() => setLoadingMore(false));
                }}
              >
                {loadingMore ? "불러오는 중…" : "더 보기"}
              </Button>
            </div>
          ) : (
            <div className="h-8" />
          )}
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
 * 한 줄 목록 ↔ 사진 격자 전환.
 * 사진을 크게 보고 싶은 사람도 있어서 격자를 없애지 않고 고르게 둔다.
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
        label="사진으로 보기"
        active={value === "grid"}
        onClick={() => onChange("grid")}
      >
        <path
          d="M3.5 3.5h5.5v5.5H3.5zM11 3.5h5.5v5.5H11zM3.5 11h5.5v5.5H3.5zM11 11h5.5v5.5H11z"
          fill="currentColor"
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
