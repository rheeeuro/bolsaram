/**
 * 회원 영역 레이아웃.
 * 모바일 우선 — 하단 탭 네비게이션, 데스크톱에서는 좌측으로 옮기지 않고
 * 컨텐츠 폭만 넓힌다(설계문서 §6, 부트스트랩 §5).
 */
import { requireUserPage } from "@/server/auth/guard";
import { MemberNav } from "@/components/member/member-nav";

export const dynamic = "force-dynamic";

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserPage();

  return (
    <div className="member-surface min-h-dvh bg-[var(--surface-page)] pb-[calc(64px+env(safe-area-inset-bottom))]">
      {children}
      <MemberNav claimed={user.profileId != null} />
    </div>
  );
}
