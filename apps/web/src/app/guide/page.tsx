/**
 * 주선자 시작 가이드.
 *
 * `docs/guide/start.md` 를 그대로 보여준다 — 문서가 단일 원본이고, 화면 사진은
 * `public/guide/` 에 있다(`pnpm guide:screenshots` 가 합성 데이터로 찍는다).
 * 문서를 고치면 **빌드해야** 화면에 반영된다.
 *
 * 로그인을 요구하지 않는다. 가입 전에 읽고 들어올 수도 있어야 하고, 이 화면에는
 * 실제 멤버 정보가 없다. 검색에는 내놓지 않는다(루트 레이아웃의 기본 noindex).
 */
import Link from "next/link";
import type { Metadata } from "next";
import { BRAND } from "@bolsaram/ui-tokens";
import { BrandLogo } from "@/components/ui/brand-logo";
import { Markdown } from "@/components/ui/markdown";
import { blockText, type Block } from "@/lib/markdown";
import { readGuide } from "@/server/docs/guide";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: `주선자 시작 가이드 · ${BRAND.nameKo}`,
};

type Section = { id: string; title: string; blocks: Block[] };

/** 첫 `##` 앞은 머리말, 그 뒤는 `##` 하나가 한 단계다. 목차와 앵커가 이 단위로 붙는다. */
function splitSections(blocks: Block[]): { intro: Block[]; sections: Section[] } {
  const intro: Block[] = [];
  const sections: Section[] = [];
  for (const block of blocks) {
    if (block.kind === "heading" && block.level === 2) {
      sections.push({ id: `step-${sections.length + 1}`, title: blockText(block), blocks: [block] });
    } else if (sections.length > 0) {
      sections[sections.length - 1]!.blocks.push(block);
    } else {
      intro.push(block);
    }
  }
  return { intro, sections };
}

function Toc({ sections }: { sections: Section[] }) {
  return (
    <ol className="flex flex-col gap-0.5">
      {sections.map((section) => (
        <li key={section.id}>
          <a
            href={`#${section.id}`}
            className="block rounded-lg px-3 py-1.5 text-[13px] leading-snug text-[var(--color-ink-600)] transition-colors hover:bg-[var(--color-ivory-200)] hover:text-[var(--color-ink-900)]"
          >
            {section.title}
          </a>
        </li>
      ))}
    </ol>
  );
}

export default function GuidePage() {
  const { intro, sections } = splitSections(readGuide("start"));

  return (
    <div className="host-surface min-h-dvh bg-[var(--surface-page)] text-[var(--surface-text)]">
      <header className="sticky top-0 z-20 border-b border-[var(--surface-border)] bg-[var(--color-ivory-50)]/92 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/" className="flex shrink-0 items-baseline">
            <BrandLogo variant="wordmark" height={20} eager />
          </Link>
          {/* 로그인하지 않았으면 /home 이 로그인 화면으로 보낸다 — 가입도 그 자리에서 된다. */}
          <Link
            href="/home"
            className="rounded-full border border-[var(--surface-border)] bg-white px-3.5 py-1.5 text-[12.5px] text-[var(--color-ink-700)] transition-colors hover:border-[var(--color-rose-300)]"
          >
            볼사람 열기
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 lg:grid lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-10">
        <aside className="hidden lg:block">
          <nav aria-label="목차" className="sticky top-16 max-h-[calc(100dvh-4rem)] overflow-y-auto py-10">
            <p className="mb-2 px-3 text-[11.5px] tracking-[0.08em] text-[var(--surface-text-muted)]">
              목차
            </p>
            <Toc sections={sections} />
          </nav>
        </aside>

        <main className="mx-auto w-full max-w-[760px] pb-24 pt-8 lg:pt-10">
          <Markdown blocks={intro} />

          {/* 좁은 화면에는 옆 목차가 없다 — 본문 앞에 접어서 둔다. */}
          <details className="mt-6 rounded-xl border border-[var(--surface-border)] bg-white lg:hidden">
            <summary className="cursor-pointer px-4 py-3 text-[13.5px] font-medium text-[var(--color-ink-800)]">
              목차 보기
            </summary>
            <nav aria-label="목차" className="px-1 pb-3">
              <Toc sections={sections} />
            </nav>
          </details>

          {sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-16">
              <Markdown blocks={section.blocks} />
            </section>
          ))}

          <p className="mt-12 border-t border-[var(--surface-border)] pt-6 text-[13px] text-[var(--color-ink-600)]">
            준비가 됐다면{" "}
            <Link href="/home" className="text-[var(--color-rose-600)] underline">
              볼사람을 열어
            </Link>{" "}
            첫 프로필을 올려 보세요. ·{" "}
            <Link href="/privacy" className="underline">
              개인정보 처리방침
            </Link>
          </p>
        </main>
      </div>
    </div>
  );
}
