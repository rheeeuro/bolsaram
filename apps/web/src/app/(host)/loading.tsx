/**
 * 주선자 화면 공통 로딩.
 *
 * 상단 네비게이션은 레이아웃이라 그대로 있고, 본문만 비운다. 화면마다 내용이 달라
 * 제목 한 줄과 패널 두 개로 자리만 잡는다.
 */
import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <LoadingLabel />
      <div className="mb-6">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-3 h-4 w-72" />
      </div>
      <div className="flex flex-col gap-5">
        {Array.from({ length: 2 }, (_, i) => (
          <Skeleton
            key={i}
            className="h-44 rounded-[var(--radius-card)] border border-[var(--surface-border)]"
          />
        ))}
      </div>
    </>
  );
}
