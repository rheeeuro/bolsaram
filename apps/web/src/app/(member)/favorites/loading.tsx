/** 관심 목록을 읽는 동안. 제목은 바로 뜨고 카드 자리만 비워 둔다. */
import { MemberHeader } from "@/components/member/member-header";
import { LoadingLabel } from "@/components/ui/skeleton";
import { CardGridSkeleton } from "@/components/member/card-grid-skeleton";

export default function Loading() {
  return (
    <>
      <MemberHeader title="관심" />
      <main className="mx-auto max-w-3xl px-4 pt-4">
        <LoadingLabel />
        <CardGridSkeleton count={4} />
      </main>
    </>
  );
}
