/**
 * 주선자 영역.
 *
 * 볼사람은 주선자를 위한 서비스다 — 이 화면들이 관리 도구가 아니라 제품 본체다.
 * 회원 화면과 같은 warm ivory 팔레트를 쓰고, 밀도만 한 단 높인다(설계문서 §13에서
 * 벗어난 결정은 `docs/implementation-plan.md` 참고).
 */
import { requireAdminPage } from "@/server/auth/guard";
import { HostNav } from "@/components/host/host-nav";

export const dynamic = "force-dynamic";

export default async function HostLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireAdminPage();

  return (
    <div className="host-surface min-h-dvh bg-[var(--surface-page)] text-[var(--surface-text)]">
      <HostNav
        displayName={viewer.displayName}
        groups={viewer.groups}
        activeGroupId={viewer.groupId}
      />
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-7">{children}</div>
    </div>
  );
}
