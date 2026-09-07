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
      </div>
    </main>
  );
}
