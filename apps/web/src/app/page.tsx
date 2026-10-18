/**
 * 인트로 (UI 컨셉 01).
 * 로그인 상태면 역할에 맞는 화면으로 바로 보낸다.
 *
 * 비로그인 방문자와 검색이 처음 보는 화면이라 무엇을 하는 곳인지 세 줄로 말한다.
 * 좁은 화면은 한 줄로 쌓고(브랜드 → 버튼 → 설명), 넓은 화면은 왼쪽 브랜드·버튼,
 * 오른쪽 설명으로 가른다. 버튼이 첫 화면 안에 들어오게 설명을 버튼 뒤에 둔다.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BRAND } from "@bolsaram/ui-tokens";
import { readSession } from "@/server/auth/session";
import { BrandLogo } from "@/components/ui/brand-logo";

export const dynamic = "force-dynamic";

// 검색에 노출하는 화면이다 — 사람 정보가 없고, 비로그인 방문자만 이 내용을 본다.
export const metadata: Metadata = {
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
};

const STEPS = [
  {
    title: "주선자가 아는 분을 등록합니다",
    body: "카카오톡으로 받은 프로필을 올리면 AI가 정리하고, 주선자가 확인한 뒤에만 공개됩니다.",
  },
  {
    title: "멤버는 초대 링크로만 들어옵니다",
    body: "자유 가입이 없습니다. 주선자가 아는 사람끼리만 서로의 프로필을 봅니다.",
  },
  {
    title: "서로 마음이 닿으면 연결됩니다",
    body: "그전까지 이름과 연락처는 보이지 않습니다. 마음은 주선자를 거쳐 전해집니다.",
  },
] as const;

export default async function IntroPage() {
  const user = await readSession();
  if (user) redirect(user.role === "ADMIN" ? "/home" : "/discover");

  return (
    <main className="member-surface relative flex min-h-dvh flex-col overflow-hidden bg-[var(--color-ivory-100)]">
      {/* 큰 인물 사진 대신 절제된 그라디언트로 분위기만 잡는다. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, var(--color-rose-100) 0%, var(--color-ivory-100) 46%, var(--color-ivory-200) 100%)",
        }}
      />

      <div className="relative mx-auto grid w-full max-w-md flex-1 content-center gap-12 px-7 pb-10 pt-20 lg:max-w-5xl lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-20 lg:px-10 lg:py-16">
        <div>
          <div className="animate-rise">
            <p className="display text-[15px] leading-relaxed text-[var(--color-burgundy-800)]">
              {BRAND.tagline}
            </p>

            {/* 로고 락업에 한글·영문이 함께 들어 있으므로 글자로 다시 쓰지 않는다. */}
            <h1 className="mt-8">
              <BrandLogo variant="stacked" height={104} eager />
            </h1>

            <p className="mt-7 text-[14px] leading-relaxed text-[var(--color-ink-700)]">
              {BRAND.subTagline}
            </p>
          </div>

          <div className="animate-fade mt-10 flex flex-col gap-2.5 lg:max-w-sm">
            {/* 가입 화면이 따로 없다 — 소셜 로그인 한 번이 가입이고 로그인이다. */}
            <Link
              href="/login"
              className="flex h-13 items-center justify-center rounded-xl bg-[var(--color-rose-600)] py-3.5 text-[15px] font-medium text-white transition-colors hover:bg-[var(--color-burgundy-700)]"
            >
              주선자로 시작하기
            </Link>
            <Link
              href="/enter"
              className="flex h-13 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-white py-3.5 text-[15px] font-medium text-[var(--color-ink-800)] transition-colors hover:bg-[var(--color-ivory-100)]"
            >
              입장코드로 들어가기
            </Link>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-ink-600)]">
              주선자는 카카오·구글로 들어오고, 멤버는 초대 링크를 열면 바로 들어갑니다.
            </p>
          </div>
        </div>

        <section aria-labelledby="intro-how" className="animate-fade">
          <h2 id="intro-how" className="display text-[19px] text-[var(--color-ink-900)]">
            볼사람은 이렇게 소개합니다
          </h2>
          <ol className="mt-5 flex flex-col gap-3">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="flex gap-4 rounded-[var(--radius-card)] border border-[var(--surface-border)] bg-white/70 px-5 py-4 backdrop-blur"
              >
                <span className="display mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[var(--color-rose-100)] text-[13px] text-[var(--color-rose-600)]">
                  {index + 1}
                </span>
                <span>
                  <span className="block text-[14.5px] font-medium text-[var(--color-ink-900)]">
                    {step.title}
                  </span>
                  <span className="mt-1 block text-[13px] leading-relaxed text-[var(--color-ink-600)]">
                    {step.body}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-[12px] text-[var(--color-ink-600)]">
            <Link href="/privacy" className="underline underline-offset-4">
              개인정보 처리방침
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
