"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { GENDERS, GENDER_LABELS } from "@bolsaram/schemas";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
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
  const [gender, setGender] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("list");

  const [items, setItems] = useState<ProfileCardView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextCursor: string | null, replace: boolean) => {
      const params = filtersToParams(filters, gender);
      if (nextCursor) params.set("cursor", nextCursor);
      const result = await apiGet<Page>(`/api/profiles?${params.toString()}`);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      setTotal(result.data.total);
      setCursor(result.data.nextCursor);
      setItems((prev) => (replace ? result.data.items : [...prev, ...result.data.items]));
    },
    [filters, gender],
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
        <div className="flex gap-1.5">
          <GenderTab label="전체" active={gender === null} onClick={() => setGender(null)} />
          {GENDERS.map((value) => (
            <GenderTab
              key={value}
              label={GENDER_LABELS[value]}
              active={gender === value}
              onClick={() => setGender(value)}
            />
          ))}
        </div>

        <ViewToggle className="ml-auto" value={view} onChange={changeView} />

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
          <p role="status" className="pb-3 text-[12px] text-[var(--color-ink-600)]">
            {total}명
          </p>
          {view === "list" ? (
            <div className="divide-y divide-[var(--surface-border)]">
              {items.map((profile) => (
                <ProfileRow key={profile.id} profile={profile} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((profile) => (
                <ProfileCard key={profile.id} profile={profile} />
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
        gender={gender}
        onClose={() => setSheetOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setSheetOpen(false);
        }}
      />
    </main>
  );
}

function GenderTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
        active
          ? "bg-[var(--color-ink-900)] text-white"
          : "bg-white text-[var(--color-ink-600)] border border-[var(--surface-border)]",
      )}
    >
      {label}
    </button>
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
