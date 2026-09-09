"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BRAND } from "@bolsaram/ui-tokens";
import { apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";

/**
 * 주선자 네비게이션.
 *
 * 볼사람에 별도의 관리자 제품이 있는 게 아니라 이 화면들이 곧 볼사람이다.
 * 그래서 로고를 그대로 쓰고 「Admin」 같은 꼬리표를 붙이지 않는다.
 * 메뉴는 알약 형태로 가로 스크롤한다 — 주선자도 대부분 폰에서 일한다.
 */

type NavLink = { href: string; label: string; exact?: boolean };

const LINKS: NavLink[] = [
  { href: "/home", label: "홈", exact: true },
  { href: "/profiles", label: "프로필" },
  { href: "/requests", label: "신청" },
  { href: "/imports", label: "가져오기" },
  { href: "/members", label: "회원" },
  { href: "/group", label: "모임" },
];

export function HostNav({ displayName }: { displayName: string | null }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--surface-border)] bg-[var(--color-ivory-50)]/92 backdrop-blur">
      <div className="mx-auto max-w-6xl px-5">
        <div className="flex items-center justify-between gap-4 pt-4">
          <Link href="/home" className="shrink-0">
            <span className="display text-[22px] leading-none text-[var(--color-ink-900)]">
              {BRAND.nameKo}
            </span>
            <span className="ml-2 hidden text-[12px] text-[var(--color-ink-500)] sm:inline">
              {BRAND.tagline}
            </span>
          </Link>

          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-[12.5px] text-[var(--surface-text-muted)] sm:inline">
              {displayName ?? "주선자"} 님
            </span>
            <button
              type="button"
              className="text-[12.5px] text-[var(--surface-text-muted)] transition-colors hover:text-[var(--color-rose-600)]"
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

        <nav className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto py-3">
          {LINKS.map((link) => {
            const active = link.exact
              ? pathname === link.href
              : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-[var(--radius-pill)] px-3.5 py-1.5 text-[13.5px]",
                  "transition-colors duration-[var(--duration-quick)]",
                  active
                    ? "bg-[var(--color-rose-500)] text-white"
                    : "text-[var(--color-ink-600)] hover:bg-[var(--color-ivory-200)]",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
