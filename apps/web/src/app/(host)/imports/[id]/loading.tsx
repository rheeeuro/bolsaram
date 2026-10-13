/**
 * 가져오기 검토를 읽는 동안. 왼쪽 원본(사진 격자·원문), 오른쪽 모임·AI 결과 폼의
 * 두 단 배치와 좁힌 간격(`tight`)을 실제와 맞춘다.
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

      <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
        <PanelSkeleton tight className="self-start">
          <Skeleton className="mb-2 h-3.5 w-32" />
          <div className="mb-4 grid grid-cols-3 gap-2">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="aspect-3/4 rounded" />
            ))}
          </div>
          <Skeleton className="h-8 w-48 rounded" />
          <Skeleton className="mt-4 mb-1.5 h-3.5 w-16" />
          <Skeleton className="h-44 w-full rounded-xl" />
          <div className="mt-2 flex gap-2">
            <Skeleton className="h-9 w-20 rounded-xl" />
            <Skeleton className="h-9 w-20 rounded-xl" />
          </div>
        </PanelSkeleton>

        <div className="flex flex-col gap-5">
          <PanelSkeleton tight>
            <div className="flex flex-wrap gap-2">
              {["w-20", "w-28", "w-24"].map((w) => (
                <Skeleton key={w} className={`h-9 rounded-full ${w}`} />
              ))}
            </div>
            <Skeleton className="mt-2.5 h-3.5 w-80 max-w-full" />
          </PanelSkeleton>
          <PanelSkeleton tight>
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 8 }, (_, i) => (
                <FieldSkeleton key={i} />
              ))}
            </div>
          </PanelSkeleton>
        </div>
      </div>
    </>
  );
}
