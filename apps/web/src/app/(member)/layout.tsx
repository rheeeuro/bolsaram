/**
 * 회원 영역 레이아웃.
 * 모바일 우선 — 하단 탭 네비게이션, 데스크톱에서는 좌측으로 옮기지 않고
 * 컨텐츠 폭만 넓힌다(설계문서 §6, 부트스트랩 §5).
 */
import { withRls } from "@bolsaram/db";
import { formatPublicCode } from "@bolsaram/domain";
import { readSession } from "@/server/auth/session";
import { rlsContextOf } from "@/server/auth/guard";
import { countPendingIncoming } from "@/server/repo/matches";
import { MemberNav } from "@/components/member/member-nav";
import { ActingBanner } from "@/components/member/acting-banner";

export const dynamic = "force-dynamic";

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  // 여기서 리다이렉트하지 않는다 — 레이아웃은 경로를 모르므로 「돌아갈 화면」을
  // 만들 수 없다. 미로그인 차단은 각 페이지가 자기 경로를 들고 한다
  // (`requireUserPage("/signals")` → `/enter?next=/signals`).
  const user = await readSession();

  // 받은 신청 수를 탭에 띄운다. 회원에게는 알림이 가지 않으므로 이 배지가
  // 새 신청을 알아차릴 유일한 신호다.
  const profileId = user?.profileId ?? null;
  const acting = user?.actingProfileId ?? null;

  const { pending, actingCode } = await (async () => {
    if (!user || !profileId) return { pending: 0, actingCode: null };
    return withRls(rlsContextOf(user), async (sql) => {
      const count = await countPendingIncoming(sql, profileId);
      if (!acting) return { pending: count, actingCode: null };
      // 대행 중이면 누구를 대신하는지 띠에 적는다. 이름이 아니라 공개 번호를 쓴다.
      const result = await sql.query<{ public_code: number }>(
        `SELECT public_code FROM profiles WHERE id = $1`,
        [acting],
      );
      const row = result.rows[0];
      return {
        pending: count,
        actingCode: row ? formatPublicCode(row.public_code) : null,
      };
    });
  })();

  return (
    <div
      className="member-surface min-h-dvh bg-[var(--surface-page)]"
      // 대행 띠는 하단 탭 위에 겹쳐 뜨므로 그만큼 바닥을 더 비운다.
      style={{
        paddingBottom: actingCode
          ? "calc(120px + env(safe-area-inset-bottom))"
          : "calc(64px + env(safe-area-inset-bottom))",
      }}
    >
      {children}
      {actingCode ? <ActingBanner code={actingCode} /> : null}
      <MemberNav claimed={profileId != null} pendingSignals={pending} />
    </div>
  );
}
