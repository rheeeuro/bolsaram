/**
 * 인트로 (UI 컨셉 01).
 * 로그인 상태면 역할에 맞는 화면으로 바로 보낸다.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@bolsaram/ui-tokens";
import { readSession } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function IntroPage() {
  const user = await readSession();
  if (user) redirect(user.role === "ADMIN" ? "/admin" : "/discover");

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

      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-between px-7 pb-10 pt-24">
        <div className="animate-rise">
          <p className="display text-[15px] leading-relaxed text-[var(--color-burgundy-800)]">
            좋은 사람을,
            <br />
            좋은 방식으로.
          </p>

          <h1 className="display mt-10 text-[56px] leading-none text-[var(--color-ink-900)]">
            {BRAND.nameKo}
          </h1>
          <p className="display mt-1 text-[20px] tracking-wide text-[var(--color-ink-600)]">
            {BRAND.nameEn}
          </p>

          <p className="mt-8 text-[14px] leading-relaxed text-[var(--color-ink-700)]">
            {BRAND.subTagline}
          </p>
          <p className="kicker mt-10">{BRAND.kicker}</p>
        </div>

        <div className="animate-fade mt-16 flex flex-col gap-2.5">
          <Link
            href="/signup"
            className="flex h-13 items-center justify-center rounded-xl bg-[var(--color-rose-500)] py-3.5 text-[15px] font-medium text-white transition-colors hover:bg-[var(--color-rose-600)]"
          >
            주선자로 시작하기
          </Link>
          <Link
            href="/enter"
            className="flex h-13 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-white py-3.5 text-[15px] font-medium text-[var(--color-ink-800)] transition-colors hover:bg-[var(--color-ivory-100)]"
          >
            입장코드로 들어가기
          </Link>
          <p className="mt-1 text-center text-[13px] text-[var(--color-ink-600)]">
            주선자 계정이 있으신가요?{" "}
            <Link href="/login" className="text-[var(--color-rose-600)] underline">
              로그인
            </Link>
          </p>
          <p className="mt-3 text-center text-[12px] leading-relaxed text-[var(--color-ink-600)]">
            볼사람은 주선자가 검증한 분만 참여하는 비공개 서비스입니다.
            <br />
            회원은 아이디·비밀번호가 없습니다 — 초대 링크를 열면 바로 들어갑니다.
          </p>
        </div>
      </div>
    </main>
  );
}
