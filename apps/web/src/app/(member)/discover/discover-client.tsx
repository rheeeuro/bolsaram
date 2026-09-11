"use client";

import { useCallback, useEffect, useState } from "react";
import { GENDERS, GENDER_LABELS } from "@bolsaram/schemas";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { ProfileCard } from "@/components/member/profile-card";
import { FilterSheet } from "@/components/member/filter-sheet";
import { MemberSubBar } from "@/components/member/member-header";
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

export function DiscoverClient() {
  const [gender, setGender] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);

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

        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className={cn(
            "ml-auto flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors",
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
        <CardSkeletonGrid />
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
          <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((profile) => (
              <ProfileCard key={profile.id} profile={profile} />
            ))}
          </div>

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

function CardSkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 pt-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-3/4 rounded-[var(--radius-card)] bg-[var(--color-ivory-200)]" />
          <div className="mt-2.5 h-3.5 w-10 rounded bg-[var(--color-ivory-200)]" />
          <div className="mt-1.5 h-3 w-24 rounded bg-[var(--color-ivory-200)]" />
        </div>
      ))}
    </div>
  );
}
