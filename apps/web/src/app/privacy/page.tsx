/**
 * 개인정보 처리방침.
 *
 * `docs/guide/privacy.md` 를 그대로 보여준다 — 문서가 단일 원본이고, 화면용으로
 * 다시 쓰면 둘이 갈라진다. 문서를 고치면 **빌드해야** 화면에 반영된다.
 *
 * 로그인을 요구하지 않는다. 무엇을 모으는지 읽어야 들어올지 정할 수 있고, 이 화면에는
 * 회원 정보가 없다.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { BRAND } from "@bolsaram/ui-tokens";
import { Markdown } from "@/components/ui/markdown";
import { readGuide } from "@/server/docs/guide";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: `개인정보 처리방침 · ${BRAND.nameKo}`,
};

export default function PrivacyPage() {
  const blocks = readGuide("privacy");

  return (
    <main className="member-surface min-h-dvh bg-[var(--color-ivory-50)]">
      <div className="mx-auto w-full max-w-2xl px-6 py-12">
        <Link
          href="/"
          className="display text-[19px] leading-none text-[var(--color-ink-700)] transition-colors hover:text-[var(--color-ink-900)]"
        >
          {BRAND.nameKo}
        </Link>

        <article className="mt-8">
          <Markdown blocks={blocks} />
        </article>

        <p className="mt-12 text-[13px] text-[var(--color-ink-600)]">
          <Link href="/" className="text-[var(--color-rose-600)] underline">
            처음으로
          </Link>
        </p>
      </div>
    </main>
  );
}
