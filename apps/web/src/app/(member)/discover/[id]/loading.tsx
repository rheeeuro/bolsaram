/**
 * 프로필 상세를 읽는 동안.
 *
 * 이것이 없으면 상위 Discover 의 목록 스켈레톤이 대신 떠서 카드를 누른 순간 화면이
 * 목록 모양으로 바뀌었다가 상세로 튄다. 사진 비율·폭과 기본 정보 표 간격을 실제와 맞춘다.
 */
import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="pb-8">
      <LoadingLabel />
      <div className="mx-auto w-full sm:mt-6 sm:max-w-[400px]">
        <Skeleton className="aspect-4/5 w-full rounded-none sm:rounded-[var(--radius-card)]" />
      </div>

      <div className="mx-auto max-w-2xl px-5">
        <div className="pt-6">
          <Skeleton className="h-[30px] w-24" />
          <Skeleton className="mt-3 h-4 w-44" />
        </div>

        <div className="mt-9">
          <Skeleton className="mb-3 h-3 w-12" />
          <div className="grid grid-cols-[80px_1fr] gap-x-4 gap-y-2.5">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="contents">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-36" />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-9">
          <Skeleton className="mb-3 h-3 w-16" />
          <div className="flex flex-wrap gap-1.5">
            {["w-14", "w-18", "w-12", "w-16"].map((w) => (
              <Skeleton key={w} className={`h-7 rounded-full ${w}`} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
