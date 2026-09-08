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
            회원을 등록해 두 사람을 연결합니다. 모임은 가입 후에 만들거나 참여합니다.
          </p>
        </header>

        <SignupForm />

        <p className="mt-8 rounded-xl bg-[var(--color-ivory-100)] px-4 py-3 text-[12.5px] leading-relaxed text-[var(--color-ink-700)]">
          이 가입은 주선자 전용입니다. 회원은 계정을 만들지 않습니다 — 주선자가 보낸 초대
          링크나 입장코드로 들어옵니다.
        </p>

        <p className="mt-6 text-[13px] text-[var(--color-ink-600)]">
          이미 계정이 있으신가요?{" "}
          <Link href="/login" className="text-[var(--color-rose-600)] underline">
            로그인
          </Link>
        </p>
      </div>
    </main>
  );
}
