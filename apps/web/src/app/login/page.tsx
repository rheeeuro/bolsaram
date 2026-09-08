import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@bolsaram/ui-tokens";
import { readSession } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await readSession();
  if (user) redirect(user.role === "ADMIN" ? "/admin" : "/discover");
  const { next } = await searchParams;

  return (
    <main className="member-surface flex min-h-dvh flex-col bg-[var(--color-ivory-50)]">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-7 py-12">
        <header className="mb-10">
          <h1 className="display text-[34px] leading-none text-[var(--color-ink-900)]">
            {BRAND.nameKo}
          </h1>
          <p className="mt-2 text-[13px] text-[var(--color-ink-600)]">{BRAND.tagline}</p>
        </header>
        <LoginForm next={next ?? null} />

        <p className="mt-8 rounded-xl bg-[var(--color-ivory-100)] px-4 py-3 text-[12.5px] leading-relaxed text-[var(--color-ink-700)]">
          입장코드와 초대 링크는 같은 것이고 한 번만 쓸 수 있습니다. 만료됐다면 주선자에게 다시
          요청하시면 됩니다.
        </p>

        <p className="mt-6 text-[13px] text-[var(--color-ink-600)]">
          아직 계정이 없으신가요?{" "}
          <Link href="/signup" className="text-[var(--color-rose-600)] underline">
            주선자로 시작하기
          </Link>
        </p>
      </div>
    </main>
  );
}
