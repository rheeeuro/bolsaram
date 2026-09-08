/**
 * 회원 영역 레이아웃.
 * 모바일 우선 — 하단 탭 네비게이션, 데스크톱에서는 좌측으로 옮기지 않고
 * 컨텐츠 폭만 넓힌다(설계문서 §6, 부트스트랩 §5).
 */
import { withRls } from "@bolsaram/db";
import { requireUserPage, rlsContextOf } from "@/server/auth/guard";
import { countPendingIncoming } from "@/server/repo/matches";
import { MemberNav } from "@/components/member/member-nav";

export const dynamic = "force-dynamic";

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserPage();

  // 받은 신청 수를 탭에 띄운다. 회원에게는 알림이 가지 않으므로 이 배지가
  // 새 신청을 알아차릴 유일한 신호다.
  const profileId = user.profileId;
  const pending = profileId
    ? await withRls(rlsContextOf(user), (sql) => countPendingIncoming(sql, profileId))
    : 0;

  return (
    <div className="member-surface min-h-dvh bg-[var(--surface-page)] pb-[calc(64px+env(safe-area-inset-bottom))]">
      {children}
      <MemberNav claimed={profileId != null} pendingSignals={pending} />
    </div>
  );
}
