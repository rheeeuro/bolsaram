/** 숨긴 사람 목록을 읽는 동안. */
import { MemberHeader } from "@/components/member/member-header";
import { LoadingLabel } from "@/components/ui/skeleton";
import { CardGridSkeleton } from "@/components/member/card-grid-skeleton";

export default function Loading() {
  return (
    <>
      <MemberHeader title="숨긴 사람" back={{ href: "/me", label: "뒤로" }} />
      <main className="mx-auto max-w-3xl px-4 pt-4">
        <LoadingLabel />
        <CardGridSkeleton count={2} />
      </main>
    </>
  );
}
