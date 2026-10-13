"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
import type { GroupRequestChoice } from "@/components/host/group-requests";

/** 관리자에게만 넘어온다. 다른 주선자에게는 관리자 메뉴가 그려지지 않는다. */
export type OperatorNav = { pending: number } | null;

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
 *
 * 관리자 계정이면 맨 아래 가이드 위에 「관리자 메뉴」가 붙는다. 모임과 무관한
 * 서비스 전체 설정이라 모임 안의 화면 목록에 섞지 않는다.
 *
 * 로그아웃은 여기 없다 — 계정을 다루는 일은 「○○ 님」을 눌러 들어가는 계정 설정
 * 화면 한 곳에 모은다. 내비게이션에 두면 모임을 고르려다 손이 스친다.
 */
export function HostNav({
  displayName,
  avatarUrl,
  groups,
  activeGroupId,
  groupRequests,
  groupApprovalRequired,
  operator,
}: {
  displayName: string | null;
  /** 내 프로필 사진의 단기 signed URL. 없으면 이름의 앞글자를 그린다. */
  avatarUrl: string | null;
  groups: GroupChoice[];
  activeGroupId: string | null;
  /** 내 모임 만들기 요청 — 승인 대기와 최근에 승인되지 않은 것. */
  groupRequests: GroupRequestChoice[];
  /** 지금 「새 모임 만들기」가 관리자 승인을 거치는가. */
  groupApprovalRequired: boolean;
  operator: OperatorNav;
}) {
  return (
    <>
      <HostSidebar
        displayName={displayName}
        avatarUrl={avatarUrl}
        groups={groups}
        activeGroupId={activeGroupId}
        groupRequests={groupRequests}
        groupApprovalRequired={groupApprovalRequired}
        operator={operator}
      />
      <HostMobileNav
        displayName={displayName}
        avatarUrl={avatarUrl}
        groups={groups}
        activeGroupId={activeGroupId}
        groupRequests={groupRequests}
        groupApprovalRequired={groupApprovalRequired}
        operator={operator}
      />
    </>
  );
}

function HostSidebar({
  displayName,
  avatarUrl,
  groups,
  activeGroupId,
  groupRequests,
  groupApprovalRequired,
  operator,
}: {
  displayName: string | null;
  avatarUrl: string | null;
  groups: GroupChoice[];
  activeGroupId: string | null;
  groupRequests: GroupRequestChoice[];
  groupApprovalRequired: boolean;
  operator: OperatorNav;
}) {
  const pathname = usePathname();
  // 모임별 안 읽음은 SSE 가 밀어주는 값이다(`ChatStreamProvider`). 여기서 따로 묻지
  // 않는다. 지금 방의 수는 목록이 아니라 오른쪽 아래 채팅 버튼이 단다.
  const { unread } = useChatStream();
  const activeName = groups.find((group) => group.id === activeGroupId)?.name ?? "전체공개";

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 overflow-y-auto border-r border-[var(--surface-border)] bg-[var(--color-ivory-50)]/92 backdrop-blur lg:block">
      <div className="flex min-h-full flex-col px-4">
        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <Link href="/home" className="flex shrink-0 items-baseline">
            <BrandLogo variant="wordmark" height={22} eager />
          </Link>

          <div className="flex w-full min-w-0 items-center gap-3">
            <AccountName displayName={displayName} avatarUrl={avatarUrl} />
          </div>
        </div>

        <GroupSwitcher
          groups={groups}
          activeGroupId={activeGroupId}
          unread={unread}
          requests={groupRequests}
          approvalRequired={groupApprovalRequired}
          isOperator={operator != null}
        />
        <div className="mt-4 border-t border-[var(--surface-border)] pt-5">
          {activeGroupId ? (
            <GroupMenu
              groupId={activeGroupId}
              groupName={activeName}
              asOperator={operator != null}
            />
          ) : (
            <p className="truncate px-2 text-[15px] font-semibold" title={activeName}>
              {activeName}
            </p>
          )}
          <p className="mt-1 px-2 text-[11px] text-[var(--surface-text-muted)]">
            {activeGroupId
              ? operator
                ? "관리자로 보는 중 · 이름을 눌러 설정·초대"
                : "이름을 눌러 설정·초대·나가기"
              : "전체공개 프로필을 함께 살펴보세요"}
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
              </Link>
            );
          })}
        </nav>

        {/* 화면 사진이 든 시작 가이드. 모임과 무관해서 메뉴 목록과 떼어 맨 아래 둔다. */}
        <div className="mb-4 mt-auto flex flex-col">
          {operator ? (
            <Link
              href="/operator"
              aria-current={pathname.startsWith("/operator") ? "page" : undefined}
              className={cn(
                "mb-2 flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition-colors",
                pathname.startsWith("/operator")
                  ? "border-[var(--color-rose-300)] bg-[var(--color-rose-600)]/10 text-[var(--color-rose-600)]"
                  : "border-[var(--surface-border)] text-[var(--color-ink-700)] hover:bg-[var(--color-ivory-200)]",
              )}
            >
              <span className="flex-1">관리자 메뉴</span>
              {operator.pending > 0 ? (
                <span className="rounded-full bg-[var(--color-rose-600)] px-1.5 text-[11px] text-white">
                  {operator.pending > 99 ? "99+" : operator.pending}
                  <span className="sr-only">건 승인 대기</span>
                </span>
              ) : null}
            </Link>
          ) : null}
          <Link
            href="/guide"
            className="rounded-lg px-3 py-2 text-[12.5px] text-[var(--surface-text-muted)] transition-colors hover:bg-[var(--color-ivory-200)] hover:text-[var(--color-ink-800)]"
          >
            사용 가이드 →
          </Link>
          <Link
            href="/updates"
            className="rounded-lg px-3 py-2 text-[12.5px] text-[var(--surface-text-muted)] transition-colors hover:bg-[var(--color-ivory-200)] hover:text-[var(--color-ink-800)]"
          >
            업데이트 소식 →
          </Link>
        </div>
      </div>
    </aside>
  );
}
