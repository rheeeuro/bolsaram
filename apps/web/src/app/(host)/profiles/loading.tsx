/**
 * 프로필 목록을 읽는 동안. 검색줄·필터·카드/원본 탭과 사진 카드 격자를 실제와 맞춘다.
 * 기본 보기가 카드라 그쪽 모양으로 둔다.
 */
import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton } from "@/components/host/skeletons";

export default function Loading() {
  return (
    <>
      <LoadingLabel />
      <PageHeaderSkeleton aside />

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-10 min-w-0 flex-1 rounded-xl sm:max-w-md" />
          <Skeleton className="h-10 w-16 rounded-xl" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-36 rounded-full" />
          <Skeleton className="h-9 w-44 rounded-full" />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <Skeleton className="h-7 w-12 rounded-full" />
        <Skeleton className="h-7 w-12 rounded-full" />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i}>
            <Skeleton className="aspect-3/4 rounded-[var(--radius-card)]" />
            <Skeleton className="mt-2.5 h-4 w-20" />
            <Skeleton className="mt-1.5 h-3 w-24" />
            <Skeleton className="mt-1 h-3 w-28" />
          </div>
        ))}
      </div>
    </>
  );
}
