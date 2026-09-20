"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { MAX_GROUPS_PER_ADMIN } from "@bolsaram/schemas";
import { cn } from "@/lib/cn";
import { BrandLogo } from "@/components/ui/brand-logo";
import { Avatar } from "@/components/ui/avatar";
import { Dialog, DialogClose } from "@/components/ui/dialog";
import { GroupCreateDialogs } from "@/components/host/group-create";
import { useChatStream } from "@/components/host/chat-stream";
import { useGroupSwitch } from "@/components/host/use-group-switch";
import {
  HOST_LINKS,
  HostNavIcon,
  isHostLinkActive,
} from "@/components/host/host-nav-links";
import type { GroupChoice } from "@/components/host/group-switcher";

/**
 * 모바일 주선자 내비게이션 — 위에서 **어느 모임을 볼지** 고르고, 아래에서 **그 모임
 * 안의 화면**으로 간다.
 *
 * 두 축을 화면의 양 끝으로 갈라 둔다. 모임을 고르는 일은 드물게 하고 화면을 오가는
 * 일은 계속 하므로, 자주 쓰는 쪽을 엄지가 닿는 아래에 놓는다. 둘 다 위에 쌓으면
 * 가로 스크롤 줄이 겹쳐 어느 쪽을 미는 것인지가 사라진다.
 *
 * 하단 탭에는 다섯 칸까지만 둔다(`primary` + 더보기). 나머지 화면과 계정·모임 설정은
 * 「더보기」 시트로 모은다. 목록 자체는 `host-nav-links` 가 사이드바와 공유한다.
 * 채팅은 이 목록에 없다 — 오른쪽 아래 떠 있는 버튼이 그 자리다.
 *
 * 로그아웃도 여기 없다. 계정을 다루는 일은 계정 설정 화면 한 곳에 모은다.
 */
export function HostMobileNav({
  displayName,
  avatarUrl,
  groups,
  activeGroupId,
}: {
  displayName: string | null;
  /** 내 프로필 사진의 단기 signed URL. 없으면 이름의 앞글자를 그린다. */
  avatarUrl: string | null;
  groups: GroupChoice[];
  activeGroupId: string | null;
}) {
  const pathname = usePathname();
  const { unread } = useChatStream();
  const [sheet, setSheet] = useState<"groups" | "more" | null>(null);

  // 시트 안의 링크를 누르면 화면만 바뀌고 시트는 남는다. 경로가 바뀌면 접는다.
  useEffect(() => {
    setSheet(null);
  }, [pathname]);

  const activeName = groups.find((group) => group.id === activeGroupId)?.name ?? "전체공개";
  // 지금 보고 있지 않은 모임에 쌓인 것. 모임 전환 버튼에 붙여 「저쪽에 뭔가 있다」만
  // 알린다. 보고 있는 모임의 수는 오른쪽 아래 채팅 버튼이 단다.
  const elsewhereUnread = Object.entries(unread).reduce(
    (sum, [groupId, count]) => (groupId === activeGroupId ? sum : sum + count),
    0,
  );

  const primary = HOST_LINKS.filter((link) => link.primary);
  const secondary = HOST_LINKS.filter((link) => !link.primary);
  // 계정 설정도 「더보기」 안에 있다 — 그 화면에 있으면 탭도 함께 켠다.
  const moreActive =
    secondary.some((link) => isHostLinkActive(link, pathname)) ||
    pathname.startsWith("/account");

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-[var(--surface-border)] bg-[var(--color-ivory-50)]/92 backdrop-blur lg:hidden">
        <div className="flex h-14 items-center gap-2 px-3">
          <BrandLogo variant="symbol" height={24} eager />
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={sheet === "groups"}
            onClick={() => setSheet("groups")}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left transition-colors hover:bg-[var(--color-ivory-200)]"
          >
            <span className="text-[11px] text-[var(--surface-text-muted)]">보는 중</span>
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
              {activeName}
            </span>
            {elsewhereUnread > 0 ? (
              <UnreadBadge count={elsewhereUnread} label="다른 모임에 안 읽음" />
            ) : null}
            <span aria-hidden className="shrink-0 text-[10px] text-[var(--surface-text-muted)]">
              ▼
            </span>
          </button>
        </div>
      </header>

      <nav
        aria-label="주선자 화면"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--surface-border)] bg-[var(--color-ivory-50)]/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="flex">
          {primary.map((link) => {
            const active = isHostLinkActive(link, pathname);
            return (
              <li key={link.href} className="flex-1">
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-[var(--host-tabbar-h)] flex-col items-center justify-center gap-1 text-[11px]",
                    "transition-colors duration-[var(--duration-quick)]",
                    active
                      ? "text-[var(--color-rose-600)]"
                      : "text-[var(--surface-text-muted)]",
                  )}
                >
                  <HostNavIcon name={link.href} />
                  {link.label}
                </Link>
              </li>
            );
          })}

          <li className="flex-1">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={sheet === "more"}
              onClick={() => setSheet("more")}
              className={cn(
                "flex h-[var(--host-tabbar-h)] w-full flex-col items-center justify-center gap-1 text-[11px]",
                "transition-colors duration-[var(--duration-quick)]",
                moreActive
                  ? "text-[var(--color-rose-600)]"
                  : "text-[var(--surface-text-muted)]",
              )}
            >
              <HostNavIcon name="more" />
              더보기
            </button>
          </li>
        </ul>
      </nav>

      <GroupSheet
        open={sheet === "groups"}
        groups={groups}
        activeGroupId={activeGroupId}
        unread={unread}
        onClose={() => setSheet(null)}
      />
      <MoreSheet
        open={sheet === "more"}
        links={secondary}
        pathname={pathname}
        displayName={displayName}
        avatarUrl={avatarUrl}
        activeGroupId={activeGroupId}
        activeName={activeName}
        onClose={() => setSheet(null)}
      />
    </>
  );
}

/** 모임 고르기. 고르면 바로 닫고 화면을 새로 받는다. */
function GroupSheet({
  open,
  groups,
  activeGroupId,
  unread,
  onClose,
}: {
  open: boolean;
  groups: GroupChoice[];
  activeGroupId: string | null;
  unread: Record<string, number>;
  onClose: () => void;
}) {
  const { switchTo, busy, error } = useGroupSwitch(activeGroupId);
  const [dialog, setDialog] = useState<"create" | "join" | null>(null);
  const full = groups.length >= MAX_GROUPS_PER_ADMIN;

  return (
    <>
      <Dialog open={open} onClose={onClose} label="내 모임" variant="sheet">
        <SheetHead title="내 모임" onClose={onClose} />

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" aria-busy={busy}>
          {[{ id: null, name: "전체공개", imageUrl: null }, ...groups].map((group) => {
            const active = group.id === activeGroupId;
            const count = group.id ? (unread[group.id] ?? 0) : 0;
            return (
              <button
                key={group.id ?? "public"}
                type="button"
                aria-pressed={active}
                disabled={busy}
                onClick={() => void switchTo(group.id, onClose)}
                className={cn(
                  "flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors disabled:opacity-60",
                  active
                    ? "bg-[var(--color-rose-600)]/10 text-[var(--color-rose-600)]"
                    : "hover:bg-[var(--color-ivory-200)]",
                )}
              >
                <Avatar
                  src={group.imageUrl}
                  name={group.name}
                  fallback={group.id ? undefined : "◎"}
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold",
                    active
                      ? "bg-[var(--color-rose-600)] text-white"
                      : "bg-[var(--color-ivory-200)] text-[var(--color-ink-600)]",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{group.name}</span>
                  <span className="block text-[11.5px] text-[var(--surface-text-muted)]">
                    {group.id ? "함께하는 모임" : "모든 주선자의 공간"}
                  </span>
                </span>
                {count > 0 ? <UnreadBadge count={count} label="개 안 읽음" /> : null}
              </button>
            );
          })}

          <div className="mt-2 border-t border-[var(--surface-border)] pt-2">
            {full ? (
              <p className="px-3 py-2 text-[12px] leading-relaxed text-[var(--surface-text-muted)]">
                모임 {MAX_GROUPS_PER_ADMIN}개를 모두 쓰고 있습니다. 쓰지 않는 모임에서
                나가면 자리가 납니다.
              </p>
            ) : (
              <>
                <SheetItem onSelect={() => setDialog("create")}>새 모임 만들기</SheetItem>
                <SheetItem onSelect={() => setDialog("join")}>초대 코드로 참여</SheetItem>
              </>
            )}
          </div>

          {error ? (
            <p role="alert" className="px-3 pt-2 text-[12px] text-[var(--color-rose-600)]">
              {error}
            </p>
          ) : null}
        </div>
      </Dialog>

      <GroupCreateDialogs which={dialog} onClose={() => setDialog(null)} />
    </>
  );
}

/** 하단 탭에 자리가 없는 화면과, 계정·모임 설정. */
function MoreSheet({
  open,
  links,
  pathname,
  displayName,
  avatarUrl,
  activeGroupId,
  activeName,
  onClose,
}: {
  open: boolean;
  links: typeof HOST_LINKS;
  pathname: string;
  displayName: string | null;
  avatarUrl: string | null;
  activeGroupId: string | null;
  activeName: string;
  onClose: () => void;
}) {
  return (
    <>
      <Dialog open={open} onClose={onClose} label="더보기" variant="sheet">
        <SheetHead title="더보기" onClose={onClose} />

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {links.map((link) => (
            <SheetItem
              key={link.href}
              href={link.href}
              icon={<HostNavIcon name={link.href} />}
              active={isHostLinkActive(link, pathname)}
            >
              {link.label}
            </SheetItem>
          ))}

          {/* 전체공개에는 설정이 없다 — 이름도 주선자도 없는 공용 방이다. */}
          {activeGroupId ? (
            <div className="mt-2 border-t border-[var(--surface-border)] pt-2">
              <SheetItem href={`/group/${activeGroupId}`}>
                「{activeName}」 모임 설정
              </SheetItem>
            </div>
          ) : null}

          <div className="mt-2 border-t border-[var(--surface-border)] pt-2">
            {/* 계정은 모임과 무관하다 — 모임 설정 아래에 선을 두고 따로 묶는다. */}
            <SheetItem
              href="/account"
              active={pathname.startsWith("/account")}
              icon={
                <Avatar
                  src={avatarUrl}
                  name={displayName ?? "주선자"}
                  className="grid size-8 place-items-center rounded-full bg-[var(--color-ivory-200)] text-[12.5px] font-semibold text-[var(--color-ink-600)]"
                />
              }
            >
              <span className="min-w-0">
                <span className="block truncate">{displayName ?? "주선자"} 님</span>
                <span className="block text-[11.5px] text-[var(--surface-text-muted)]">
                  계정 설정 — 이름 · 텔레그램 연결 · 로그아웃
                </span>
              </span>
            </SheetItem>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function SheetHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-5 pb-1 pt-4">
      <h2 className="display text-[18px] text-[var(--surface-text)]">{title}</h2>
      <DialogClose onClose={onClose} />
    </div>
  );
}

/** 시트 한 줄. `href` 를 주면 링크, `onSelect` 를 주면 버튼이다. */
function SheetItem({
  href,
  onSelect,
  icon,
  active,
  danger,
  children,
}: {
  href?: string;
  onSelect?: () => void;
  icon?: ReactNode;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  const className = cn(
    "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[14px] transition-colors",
    danger
      ? "text-[var(--color-rose-600)] hover:bg-[var(--color-rose-100)]"
      : active
        ? "bg-[var(--color-rose-600)]/10 text-[var(--color-rose-600)]"
        : "text-[var(--surface-text)] hover:bg-[var(--color-ivory-200)]",
  );

  if (href) {
    return (
      <Link href={href} aria-current={active ? "page" : undefined} className={className}>
        {icon ? <span className="shrink-0">{icon}</span> : null}
        {children}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onSelect} className={className}>
      {icon ? <span className="shrink-0">{icon}</span> : null}
      {children}
    </button>
  );
}

/**
 * 안 읽음 수. `floating` 은 아이콘 모서리에 겹쳐 띄우는 것이고,
 * 그냥 두면 줄 안에서 자리를 차지한다.
 */
function UnreadBadge({
  count,
  label,
  floating,
}: {
  count: number;
  label: string;
  floating?: boolean;
}) {
  return (
    <span
      className={cn(
        "grid h-4 min-w-4 shrink-0 place-items-center rounded-[var(--radius-pill)]",
        "bg-[var(--color-rose-600)] px-1 text-[10px] font-medium leading-none text-white",
        floating && "absolute -right-2.5 -top-1",
      )}
    >
      {count > 99 ? "99+" : count}
      <span className="sr-only">{label}</span>
    </span>
  );
}
