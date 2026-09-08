import { BRAND } from "@bolsaram/ui-tokens";
import { requireUserPage } from "@/server/auth/guard";
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
      <header className="sticky top-0 z-20 border-b border-[var(--surface-border)] bg-[var(--surface-page)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3.5">
          <h1 className="display text-[22px] text-[var(--color-ink-900)]">{BRAND.nameKo}</h1>
        </div>
      </header>
      <DiscoverClient />
    </>
  );
}
