"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/discover", label: "홈" },
  { href: "/favorites", label: "관심" },
  { href: "/signals", label: "시그널" },
  { href: "/me", label: "내 프로필" },
] as const;

export function MemberNav({ claimed }: { claimed: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--surface-border)] bg-white/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-3xl">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          // Claim 전에는 시그널/내 프로필이 비어 있으므로 표시만 흐리게 둔다.
          const dimmed = !claimed && (tab.href === "/signals" || tab.href === "/me");
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[12px] transition-colors",
                  active
                    ? "text-[var(--color-rose-600)]"
                    : dimmed
                      ? "text-[var(--color-ink-400)]"
                      : "text-[var(--color-ink-600)]",
                )}
                aria-current={active ? "page" : undefined}
              >
                <TabIcon name={tab.label} active={active} />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** 아이콘은 얇은 선으로 통일한다. 하트를 남발하지 않는다(설계문서 §13). */
function TabIcon({ name, active }: { name: string; active: boolean }) {
  const stroke = active ? "var(--color-rose-600)" : "currentColor";
  const common = { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none" } as const;
  switch (name) {
    case "홈":
      return (
        <svg {...common} aria-hidden>
          <path
            d="M3 8.5 10 3l7 5.5V16a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1V8.5Z"
            stroke={stroke}
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "관심":
      return (
        <svg {...common} aria-hidden>
          <path
            d="M10 16s-6-3.7-6-7.6A3.4 3.4 0 0 1 10 6.3a3.4 3.4 0 0 1 6 2.1C16 12.3 10 16 10 16Z"
            stroke={stroke}
            strokeWidth="1.3"
            strokeLinejoin="round"
            fill={active ? "var(--color-rose-500)" : "none"}
          />
        </svg>
      );
    case "시그널":
      return (
        <svg {...common} aria-hidden>
          <path
            d="M3 6.5 10 11l7-4.5M3 6.5v7A1.5 1.5 0 0 0 4.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 15.5 5h-11A1.5 1.5 0 0 0 3 6.5Z"
            stroke={stroke}
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return (
        <svg {...common} aria-hidden>
          <circle cx="10" cy="7" r="3" stroke={stroke} strokeWidth="1.3" />
          <path
            d="M4 17c0-2.8 2.7-4.5 6-4.5s6 1.7 6 4.5"
            stroke={stroke}
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}
