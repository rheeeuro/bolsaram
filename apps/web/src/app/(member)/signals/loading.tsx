/** 시그널을 읽는 동안. 탭 줄과 행 높이를 실제 목록과 맞춘다. */
import { MemberHeader, MemberSubBar } from "@/components/member/member-header";
import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <MemberHeader title="시그널" />
      <main className="mx-auto max-w-3xl px-4">
        <MemberSubBar className="gap-1.5">
          <Skeleton className="h-7 w-14 rounded-full" />
          <Skeleton className="h-7 w-14 rounded-full" />
          <Skeleton className="h-7 w-16 rounded-full" />
        </MemberSubBar>
        <LoadingLabel />
        <ul className="flex flex-col gap-2.5">
          {Array.from({ length: 3 }, (_, i) => (
            <li
              key={i}
              className="flex gap-3 rounded-[var(--radius-card)] border border-[var(--surface-border)] bg-white p-3.5"
            >
              <Skeleton className="h-18 w-14 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="mt-2 h-3 w-32" />
                <Skeleton className="mt-3 h-8 w-40 rounded-lg" />
              </div>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
