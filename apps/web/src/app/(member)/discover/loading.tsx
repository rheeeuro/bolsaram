/**
 * Discover 의 첫 그림.
 *
 * 목록 자체는 클라이언트가 불러오고 그쪽에도 같은 스켈레톤이 있다. 여기 있는 것은
 * 세션을 확인하는 동안 — 그 사이가 비면 탭을 눌러도 반응이 없는 것처럼 보인다.
 */
import { BrandLogo } from "@/components/ui/brand-logo";
import { MemberHeader, MemberSubBar } from "@/components/member/member-header";
import { CardRowsSkeleton } from "@/components/member/card-grid-skeleton";
import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <MemberHeader title={<BrandLogo variant="wordmark" height={21} eager />} />
      <main className="mx-auto max-w-3xl px-4">
        <MemberSubBar>
          <Skeleton className="h-7 w-12 rounded-full" />
          <Skeleton className="h-7 w-12 rounded-full" />
          <Skeleton className="ml-auto h-7 w-16 rounded-full" />
        </MemberSubBar>
        <LoadingLabel />
        <div className="pt-3">
          {/* 기본 보기가 한 줄 목록이라 그쪽에 맞춘다. */}
          <CardRowsSkeleton />
        </div>
      </main>
    </>
  );
}
