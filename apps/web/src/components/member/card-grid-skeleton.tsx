import { Skeleton } from "@/components/ui/skeleton";

/**
 * Discover·관심·숨긴 사람이 공유하는 목록 스켈레톤.
 * 비율(`aspect-3/4`)·썸네일 크기·열 수를 실제 목록과 맞춘다 — 다르면 채워질 때 화면이 튄다.
 */
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <Skeleton className="aspect-3/4 rounded-[var(--radius-card)]" />
          <Skeleton className="mt-2.5 h-3.5 w-10" />
          <Skeleton className="mt-1.5 h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

/** 한 줄 목록으로 볼 때의 스켈레톤. 행 높이를 `ProfileRow` 와 맞춘다. */
export function CardRowsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="divide-y divide-[var(--surface-border)]">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-2.5">
          <Skeleton className="h-16 w-16 shrink-0 rounded-[var(--radius-card)]" />
          <div className="flex-1">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 원본으로 볼 때의 스켈레톤. 사진 묶음 폭과 글 상자를 `ProfileRawRow` 와 맞춘다. */
export function RawRowsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-[var(--radius-card)] border border-[var(--surface-border)] bg-white p-3.5"
        >
          <Skeleton className="h-3.5 w-28" />
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <Skeleton className="aspect-square w-44 shrink-0 rounded-[var(--radius-card)] sm:w-48" />
            <Skeleton className="h-40 flex-1 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}
