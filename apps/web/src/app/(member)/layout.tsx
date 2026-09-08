/**
 * 회원 영역 레이아웃.
 * 모바일 우선 — 하단 탭 네비게이션, 데스크톱에서는 좌측으로 옮기지 않고
 * 컨텐츠 폭만 넓힌다(설계문서 §6, 부트스트랩 §5).
 */
import { withRls } from "@bolsaram/db";
import { readSession } from "@/server/auth/session";
import { rlsContextOf } from "@/server/auth/guard";
import { countPendingIncoming } from "@/server/repo/matches";
import { MemberNav } from "@/components/member/member-nav";

export const dynamic = "force-dynamic";

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  // 여기서 리다이렉트하지 않는다 — 레이아웃은 경로를 모르므로 「돌아갈 화면」을
  // 만들 수 없다. 미로그인 차단은 각 페이지가 자기 경로를 들고 한다
  // (`requireUserPage("/signals")` → `/enter?next=/signals`).
  const user = await readSession();

  // 받은 신청 수를 탭에 띄운다. 회원에게는 알림이 가지 않으므로 이 배지가
  // 새 신청을 알아차릴 유일한 신호다.
  const profileId = user?.profileId ?? null;
  const pending =
    user && profileId
      ? await withRls(rlsContextOf(user), (sql) => countPendingIncoming(sql, profileId))
      : 0;

  return (
    <div className="member-surface min-h-dvh bg-[var(--surface-page)] pb-[calc(64px+env(safe-area-inset-bottom))]">
      {children}
      <MemberNav claimed={profileId != null} pendingSignals={pending} />
    </div>
  );
}
