/**
 * 업데이트 소식.
 *
 * `docs/guide/updates.md` 를 그대로 보여준다 — `##` 하나가 한 주이고 최근 주가 위다.
 * 주간 작업(`pnpm updates:weekly`)이 빌드 없이 파일에 덧붙이므로 요청마다 다시 읽는다.
 *
 * 주선자와 멤버가 함께 읽는다. 로그인을 요구하지 않고(멤버 정보가 없다) 검색에는
 * 내놓지 않는다(루트 레이아웃의 기본 noindex).
 */
import Link from "next/link";
import type { Metadata } from "next";
import { BRAND } from "@bolsaram/ui-tokens";
import { BrandLogo } from "@/components/ui/brand-logo";
import { Markdown } from "@/components/ui/markdown";
import { readGuide } from "@/server/docs/guide";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `업데이트 소식 · ${BRAND.nameKo}`,
};

export default function UpdatesPage() {
  const blocks = readGuide("updates");

  return (
    <main className="member-surface min-h-dvh bg-[var(--color-ivory-50)]">
      <div className="mx-auto w-full max-w-2xl px-6 py-12">
        <Link href="/" className="inline-block opacity-80 transition-opacity hover:opacity-100">
          <BrandLogo variant="wordmark" height={22} />
        </Link>

        <article className="mt-8">
          <Markdown blocks={blocks} />
        </article>

        {/* `/` 는 로그인한 사람을 역할에 맞는 첫 화면으로 보낸다. */}
        <p className="mt-12 border-t border-[var(--surface-border)] pt-6 text-[13px] text-[var(--color-ink-600)]">
          <Link href="/" className="text-[var(--color-rose-600)] underline">
            볼사람으로 돌아가기
          </Link>{" "}
          ·{" "}
          <Link href="/privacy" className="underline">
            개인정보 처리방침
          </Link>
        </p>
      </div>
    </main>
  );
}
