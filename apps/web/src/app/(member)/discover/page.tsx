import { requireUserPage } from "@/server/auth/guard";
import { BrandLogo } from "@/components/ui/brand-logo";
import { MemberHeader } from "@/components/member/member-header";
import { DiscoverClient } from "./discover-client";

export const dynamic = "force-dynamic";

/**
 * Discover (UI 컨셉 02).
 * 첫 페이지는 클라이언트에서 불러온다 — 성별 탭/필터가 바뀔 때마다 같은 경로를 쓰기 위해서다.
 */
export default async function DiscoverPage() {
  // 미로그인 차단은 페이지가 한다 — 레이아웃은 경로를 몰라 돌아갈 화면을 못 만든다.
  await requireUserPage("/discover");

  return (
    <>
      <MemberHeader title={<BrandLogo variant="wordmark" height={21} eager />} />
      <DiscoverClient />
    </>
  );
}
