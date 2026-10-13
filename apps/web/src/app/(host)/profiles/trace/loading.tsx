/**
 * 캡처본 확인을 여는 동안. 이것이 없으면 상위 프로필 목록의 격자 스켈레톤이 대신 뜬다.
 */
import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";
import { BreadcrumbSkeleton } from "@/components/host/skeletons";

export default function Loading() {
  return (
    <>
      <LoadingLabel />
      <BreadcrumbSkeleton />
      <div className="mb-6">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-3 h-4 w-72" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <Skeleton className="h-72 rounded-[var(--radius-card)] border border-[var(--surface-border)]" />
        <Skeleton className="h-44 rounded-[var(--radius-card)] border border-[var(--surface-border)]" />
      </div>
    </>
  );
}
