import { Skeleton } from "@/components/ui/skeleton";

/**
 * Discover·관심·숨긴 사람이 공유하는 카드 격자 스켈레톤.
 * 비율(`aspect-3/4`)과 열 수를 실제 목록과 맞춘다 — 다르면 채워질 때 화면이 튄다.
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
