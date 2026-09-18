"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { BrandLogo } from "@/components/ui/brand-logo";
import { AccountName } from "@/components/host/account-name";
import { GroupSwitcher, type GroupChoice } from "@/components/host/group-switcher";
import { GroupMenu } from "@/components/host/group-menu";
import { HostMobileNav } from "@/components/host/host-mobile-nav";
import {
  HOST_LINKS,
  HostNavIcon,
  isHostLinkActive,
} from "@/components/host/host-nav-links";
import { useChatStream } from "@/components/host/chat-stream";

/**
 * 주선자 내비게이션. 화면 폭에 따라 **다른 물건 두 개**를 그린다.
 *
 * 넓은 화면(`lg` 이상)은 왼쪽 사이드바다 — 모임 목록과 화면 목록이 한눈에 펼쳐진다.
 * 좁은 화면은 위아래로 갈린 모바일 내비게이션이고 `HostMobileNav` 가 맡는다.
 * 둘은 같은 목적지 집합(`host-nav-links`)과 같은 모임 전환 경로(`useGroupSwitch`)를
 * 쓰지만 배치가 전혀 달라 한 마크업으로 묶지 않는다.
 *
 * 사이드바는 세 층이다 — 위에서 **모임을 고르고**, 가운데 이름 줄에서 **그 모임을
 * 다루고**, 아래 목록에서 **그 모임 안의 화면**으로 간다. 아래 목록에는 모임에 속한
 * 화면만 둔다. 설정·초대·나가기는 이름 줄의 메뉴로 들어간다 — 같은 줄에 섞으면
 * 모임을 바꿔도 안 바뀌는 화면이 하나 껴 있게 된다.
 *
 * 전체공개에는 메뉴가 없다. 이름도 주선자도 없는 공용 방이라 다룰 것이 없다.
 */
export function HostNav({
  displayName,
  groups,
  activeGroupId,
}: {
  displayName: string | null;
  groups: GroupChoice[];
  activeGroupId: string | null;
}) {
  return (
    <>
      <HostSidebar
        displayName={displayName}
        groups={groups}
        activeGroupId={activeGroupId}
      />
      <HostMobileNav
        displayName={displayName}
        groups={groups}
        activeGroupId={activeGroupId}
      />
    </>
  );
}

function HostSidebar({
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
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 overflow-y-auto border-r border-[var(--surface-border)] bg-[var(--color-ivory-50)]/92 backdrop-blur lg:block">
      <div className="flex min-h-full flex-col px-4">
        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <Link href="/home" className="flex shrink-0 items-baseline">
            <BrandLogo variant="wordmark" height={22} eager />
          </Link>

          <div className="flex w-full min-w-0 items-center justify-between gap-3">
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
        <div className="mt-4 border-t border-[var(--surface-border)] pt-5">
          {activeGroupId ? (
            <GroupMenu groupId={activeGroupId} groupName={activeName} />
          ) : (
            <p className="truncate px-2 text-[15px] font-semibold" title={activeName}>
              {activeName}
            </p>
          )}
          <p className="mt-1 px-2 text-[11px] text-[var(--surface-text-muted)]">
            {activeGroupId ? "이름을 눌러 설정·초대·나가기" : "전체공개 프로필을 함께 살펴보세요"}
          </p>
        </div>

        <nav aria-label="모임 안의 화면" className="flex flex-col gap-1 py-3">
          {HOST_LINKS.map((link) => {
            const active = isHostLinkActive(link, pathname);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px]",
                  "transition-colors duration-[var(--duration-quick)]",
                  active
                    ? "bg-[var(--color-rose-600)] text-white"
                    : "text-[var(--color-ink-600)] hover:bg-[var(--color-ivory-200)]",
                )}
              >
                <span className="shrink-0 opacity-90">
                  <HostNavIcon name={link.href} />
                </span>
                {link.label}
                {link.href === "/chat" && hereUnread > 0 ? (
                  <span
                    className={cn(
                      "ml-auto inline-flex min-w-4 items-center justify-center rounded-[var(--radius-pill)]",
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
    </aside>
  );
}
