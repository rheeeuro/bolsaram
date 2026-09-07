import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@bolsaram/ui-tokens";
import { readSession } from "@/server/auth/session";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const user = await readSession();
  if (user) redirect(user.role === "ADMIN" ? "/admin" : "/discover");

  return (
    <main className="member-surface flex min-h-dvh flex-col bg-[var(--color-ivory-50)]">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-7 py-12">
        <header className="mb-8">
          <p className="kicker mb-3">{BRAND.kicker}</p>
          <h1 className="display text-[28px] leading-tight text-[var(--color-ink-900)]">
            주선자로 시작하기
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-ink-600)]">
            모임을 만들고 회원을 등록해 두 사람을 연결합니다.
          </p>
        </header>

        <SignupForm />

        <p className="mt-8 text-[13px] text-[var(--color-ink-600)]">
          이미 계정이 있으신가요?{" "}
          <Link href="/login" className="text-[var(--color-rose-600)] underline">
            로그인
          </Link>
        </p>
      </div>
    </main>
  );
}
