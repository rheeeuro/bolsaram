"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { BrandLogo } from "@/components/ui/brand-logo";
import { AccountName } from "@/components/host/account-name";
import { GroupSwitcher, type GroupChoice } from "@/components/host/group-switcher";
import { GroupMenu } from "@/components/host/group-menu";
import { useChatStream } from "@/components/host/chat-stream";

/**
 * 모임 목록과 선택한 모임의 화면을 계층으로 보여주는 내비게이션.
 *
 * 세 층이다 — 위에서 **모임을 고르고**, 가운데 이름 줄에서 **그 모임을 다루고**,
 * 아래 `#` 목록에서 **그 모임 안의 화면**으로 간다. 아래 목록에는 모임에 속한 화면만
 * 둔다. 설정·초대·나가기는 이름 줄의 메뉴로 들어간다 — 같은 줄에 섞으면 모임을
 * 바꿔도 안 바뀌는 화면이 하나 껴 있게 된다.
 *
 * 전체공개에는 메뉴가 없다. 이름도 주선자도 없는 공용 방이라 다룰 것이 없다.
 */

type NavLink = { href: string; label: string; exact?: boolean };

const LINKS: NavLink[] = [
  { href: "/home", label: "홈", exact: true },
  { href: "/profiles", label: "프로필" },
  { href: "/requests", label: "신청" },
  { href: "/imports", label: "가져오기" },
  { href: "/members", label: "회원" },
  { href: "/chat", label: "채팅" },
];

export function HostNav({
  displayName,
  groups,
  activeGroupId,
}: {
  displayName: string | null;
  groups: GroupChoice[];
  activeGroupId: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // 배지는 SSE 가 밀어주는 값이다(`ChatStreamProvider`). 여기서 따로 묻지 않는다.
  const { unread } = useChatStream();
  const hereUnread = activeGroupId ? (unread[activeGroupId] ?? 0) : 0;
  const activeName = groups.find((group) => group.id === activeGroupId)?.name ?? "전체공개";

  return (
    <header className="sticky top-0 z-30 lg:fixed lg:bottom-0 lg:left-0 lg:w-64 lg:overflow-y-auto lg:border-r border-b border-[var(--surface-border)] bg-[var(--color-ivory-50)]/92 backdrop-blur">
      <div className="px-4 lg:flex lg:min-h-full lg:flex-col">
        <div className="flex items-center justify-between gap-3 py-4 lg:flex-wrap">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/home" className="flex shrink-0 items-baseline">
              <BrandLogo variant="wordmark" height={22} eager />
            </Link>
          </div>

          <div className="flex min-w-0 items-center gap-3 lg:w-full lg:justify-between">
            <AccountName displayName={displayName} />
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

        <GroupSwitcher groups={groups} activeGroupId={activeGroupId} unread={unread} />
        <div className="mt-2 border-t border-[var(--surface-border)] pt-3 lg:mt-4 lg:pt-5">
          {activeGroupId ? (
            <GroupMenu groupId={activeGroupId} groupName={activeName} />
          ) : (
            <p className="truncate px-2 text-[15px] font-semibold" title={activeName}>
              {activeName}
            </p>
          )}
          <p className="mt-1 hidden px-2 text-[11px] text-[var(--surface-text-muted)] lg:block">
            {activeGroupId ? "이름을 눌러 설정·초대·나가기" : "전체공개 프로필을 함께 살펴보세요"}
          </p>
        </div>
        <nav
          aria-label="모임 안의 화면"
          className="flex gap-1 overflow-x-auto py-3 lg:flex-col lg:overflow-visible"
        >
          {LINKS.map((link) => {
            const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 shrink-0 items-center rounded-lg px-3.5 py-2 text-[13.5px]",
                  "transition-colors duration-[var(--duration-quick)]",
                  active
                    ? "bg-[var(--color-rose-600)] text-white"
                    : "text-[var(--color-ink-600)] hover:bg-[var(--color-ivory-200)]",
                )}
              >
                <span aria-hidden className="mr-2 text-base opacity-60">
                  #
                </span>
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
