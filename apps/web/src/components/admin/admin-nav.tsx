"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";

type NavLink = { href: string; label: string; exact?: boolean };

const LINKS: NavLink[] = [
  { href: "/admin", label: "대시보드", exact: true },
  { href: "/admin/imports", label: "Import Inbox" },
  { href: "/admin/profiles", label: "프로필" },
  { href: "/admin/requests", label: "신청" },
  { href: "/admin/members", label: "회원" },
  { href: "/admin/group", label: "모임" },
];

export function AdminNav({ displayName }: { displayName: string | null }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--surface-border)] bg-[var(--surface-card)]">
      <div className="mx-auto flex max-w-7xl items-center gap-1 px-5">
        <Link
          href="/admin"
          className="mr-4 shrink-0 py-3 text-[14px] font-semibold tracking-tight"
        >
          볼사람 <span className="font-normal text-[var(--surface-text-muted)]">Admin</span>
        </Link>

        <nav className="no-scrollbar flex flex-1 gap-0.5 overflow-x-auto">
          {LINKS.map((link) => {
            const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "shrink-0 border-b-2 px-3 py-3 text-[13.5px] transition-colors",
                  active
                    ? "border-[var(--surface-accent)] font-medium text-[var(--surface-text)]"
                    : "border-transparent text-[var(--surface-text-muted)] hover:text-[var(--surface-text)]",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-4 flex shrink-0 items-center gap-3">
          <span className="hidden text-[12.5px] text-[var(--surface-text-muted)] sm:inline">
            {displayName ?? "관리자"}
          </span>
          <button
            type="button"
            className="text-[12.5px] text-[var(--surface-text-muted)] underline hover:text-[var(--surface-text)]"
            onClick={() => {
              void apiPost("/api/auth/logout").then(() => {
                router.replace("/");
                router.refresh();
              });
            }}
          >
            로그아웃
          </button>
        </div>
      </div>
    </header>
  );
}
