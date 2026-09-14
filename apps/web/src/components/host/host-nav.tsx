"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BRAND } from "@bolsaram/ui-tokens";
import { apiGet, apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { BrandLogo } from "@/components/ui/brand-logo";
import { GroupSwitcher, type GroupChoice } from "@/components/host/group-switcher";

/**
 * 주선자 네비게이션.
 *
 * 볼사람에 별도의 관리자 제품이 있는 게 아니라 이 화면들이 곧 볼사람이다.
 * 그래서 로고를 그대로 쓰고 「Admin」 같은 꼬리표를 붙이지 않는다.
 * 메뉴는 알약 형태로 가로 스크롤한다 — 주선자도 대부분 폰에서 일한다.
 *
 * 로고 옆의 전환기가 지금 보고 있는 모임을 말한다. 아래 메뉴는 전부 그 모임 안의
 * 화면이다 — 모임을 바꾸면 같은 메뉴가 다른 모임의 내용을 보여준다.
 *
 * 「채팅」 옆 숫자는 **보고 있는 모임**의 안 읽은 글이다. 다른 모임에 안 읽은 것이
 * 있으면 전환기에 점이 붙는다 — 방을 옮기지 않아도 알아채라는 뜻이다.
 */

type NavLink = { href: string; label: string; exact?: boolean };

const LINKS: NavLink[] = [
  { href: "/home", label: "홈", exact: true },
  { href: "/profiles", label: "프로필" },
  { href: "/requests", label: "신청" },
  { href: "/imports", label: "가져오기" },
  { href: "/members", label: "회원" },
  { href: "/chat", label: "채팅" },
  { href: "/group", label: "모임" },
];

/** 배지 갱신 간격. 방 안에서는 채팅 화면이 초 단위로 따라가므로 여기는 느긋해도 된다. */
const UNREAD_POLL_MS = 20_000;

export type UnreadMap = Record<string, number>;

/**
 * 안 읽은 개수를 주기적으로 다시 읽는다. 화면이 덮여 있으면 묻지 않는다.
 * 첫 값은 서버 렌더에서 온 것이라 화면이 뜨자마자 배지가 맞다.
 */
function useUnread(initial: UnreadMap): UnreadMap {
  const [unread, setUnread] = useState(initial);

  useEffect(() => {
    let stopped = false;

    async function poll() {
      if (document.hidden) return;
      const result = await apiGet<{ groups: { groupId: string; unread: number }[] }>(
        "/api/admin/chat",
      );
      if (stopped || !result.ok) return;
      setUnread(Object.fromEntries(result.data.groups.map((g) => [g.groupId, g.unread])));
    }

    const timer = setInterval(() => void poll(), UNREAD_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return unread;
}

export function HostNav({
  displayName,
  groups,
  activeGroupId,
  initialUnread,
}: {
  displayName: string | null;
  groups: GroupChoice[];
  activeGroupId: string | null;
  initialUnread: UnreadMap;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const unread = useUnread(initialUnread);
  const hereUnread = activeGroupId ? (unread[activeGroupId] ?? 0) : 0;
  const elsewhereUnread = Object.entries(unread).some(
    ([groupId, count]) => groupId !== activeGroupId && count > 0,
  );

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--surface-border)] bg-[var(--color-ivory-50)]/92 backdrop-blur">
      <div className="mx-auto max-w-6xl px-5">
        <div className="flex items-center justify-between gap-4 pt-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/home" className="flex shrink-0 items-baseline">
              <BrandLogo variant="wordmark" height={22} eager />
              <span className="ml-2.5 hidden text-[12px] text-[var(--color-ink-500)] lg:inline">
                {BRAND.tagline}
              </span>
            </Link>
            <GroupSwitcher
              groups={groups}
              activeGroupId={activeGroupId}
              unread={unread}
              elsewhereUnread={elsewhereUnread}
            />
          </div>

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
                    ? "bg-[var(--color-rose-600)] text-white"
                    : "text-[var(--color-ink-600)] hover:bg-[var(--color-ivory-200)]",
                )}
              >
                {link.label}
                {link.href === "/chat" && hereUnread > 0 ? (
                  <span
                    className={cn(
                      "ml-1.5 inline-flex min-w-4 items-center justify-center rounded-[var(--radius-pill)]",
                      "px-1 py-px text-[11px] leading-4",
                      active
                        ? "bg-white/25 text-white"
                        : "bg-[var(--color-rose-600)] text-white",
                    )}
                  >
                    {hereUnread > 99 ? "99+" : hereUnread}
                    <span className="sr-only">개 안 읽음</span>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
