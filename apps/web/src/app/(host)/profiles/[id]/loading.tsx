/**
 * 프로필 상세를 읽는 동안. 대표 사진 카드와 그 아래 사진·항목 패널 순서를 맞춘다.
 * 이것이 없으면 상위 목록의 격자 스켈레톤이 대신 뜬다.
 */
import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";
import { BreadcrumbSkeleton, PanelSkeleton } from "@/components/host/skeletons";

export default function Loading() {
  return (
    <>
      <LoadingLabel />
      <BreadcrumbSkeleton />

      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-5 rounded-[var(--radius-card)] border border-[var(--surface-border)] bg-[var(--surface-card)] p-5">
          <Skeleton className="h-32 w-24 shrink-0 rounded-[12px]" />
          <div className="min-w-48 flex-1">
            <Skeleton className="h-7 w-28" />
            <Skeleton className="mt-3 h-4 w-48" />
            <Skeleton className="mt-3 h-6 w-32 rounded-full" />
            <Skeleton className="mt-2.5 h-3 w-40" />
          </div>
          <div className="flex w-full gap-2.5 sm:w-auto">
            <Skeleton className="h-10 flex-1 rounded-xl sm:w-24 sm:flex-none" />
            <Skeleton className="h-10 flex-1 rounded-xl sm:w-24 sm:flex-none" />
          </div>
        </div>

        {/* 주선자가 여는 상세는 대부분 자기가 등록한 분이라 메모·상태 단이 붙는 배치로 둔다. */}
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-5">
            <PanelSkeleton>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {Array.from({ length: 2 }, (_, i) => (
                  <Skeleton key={i} className="aspect-3/4 rounded-[12px]" />
                ))}
              </div>
            </PanelSkeleton>

            <PanelSkeleton>
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="h-4 w-20 shrink-0" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ))}
              </div>
            </PanelSkeleton>
          </div>

          <div className="flex flex-col gap-5">
            <PanelSkeleton>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="mt-3 h-36 w-full rounded-xl" />
            </PanelSkeleton>
            <PanelSkeleton>
              <Skeleton className="h-11 w-full rounded-xl" />
            </PanelSkeleton>
          </div>
        </div>
      </div>
    </>
  );
}
