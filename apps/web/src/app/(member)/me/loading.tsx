/** 내 프로필을 읽는 동안. 사진·요약·항목표 순서를 그대로 비워 둔다. */
import { MemberHeader } from "@/components/member/member-header";
import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <MemberHeader title="내 프로필" />
      <main className="mx-auto max-w-2xl px-5 pb-8">
        <LoadingLabel />
        <div className="flex items-center gap-4 pt-6">
          <Skeleton className="h-20 w-16 rounded-xl" />
          <div>
            <Skeleton className="h-6 w-20" />
            <Skeleton className="mt-2.5 h-4 w-28" />
          </div>
        </div>
        <div className="mt-8 grid grid-cols-[92px_1fr] gap-x-4 gap-y-3">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="contents">
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
