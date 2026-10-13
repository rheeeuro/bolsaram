/**
 * 프로필 고치기를 읽는 동안. 머리 카드, 왼쪽 입력 패널, 오른쪽 사진 패널 배치를 맞춘다.
 * 이것이 없으면 상위 상세 스켈레톤이 대신 뜬다.
 */
import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";
import {
  BreadcrumbSkeleton,
  FieldSkeleton,
  PanelSkeleton,
} from "@/components/host/skeletons";

export default function Loading() {
  return (
    <>
      <LoadingLabel />
      <BreadcrumbSkeleton />

      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] border border-[var(--surface-border)] bg-[var(--surface-card)] px-5 py-4">
          <div>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="mt-2.5 h-3.5 w-56" />
          </div>
          <Skeleton className="h-10 w-32 rounded-xl" />
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <PanelSkeleton>
            <div className="grid gap-3.5 sm:grid-cols-2">
              {Array.from({ length: 8 }, (_, i) => (
                <FieldSkeleton key={i} />
              ))}
            </div>
          </PanelSkeleton>

          <PanelSkeleton className="self-start">
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="aspect-3/4 rounded-[12px]" />
              ))}
            </div>
          </PanelSkeleton>
        </div>
      </div>
    </>
  );
}
