import { BRAND } from "@bolsaram/ui-tokens";
import { DiscoverClient } from "./discover-client";

export const dynamic = "force-dynamic";

/**
 * Discover (UI 컨셉 02).
 * 첫 페이지는 클라이언트에서 불러온다 — 성별 탭/필터가 바뀔 때마다 같은 경로를 쓰기 위해서다.
 */
export default function DiscoverPage() {
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
