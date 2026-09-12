"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogClose } from "@/components/ui/dialog";
import { apiPut } from "@/lib/api-client";
import { cn } from "@/lib/cn";

/**
 * 모임(채널) 전환기.
 *
 * 주선자는 여러 모임에 동시에 속한다. 카카오톡 단톡방을 고르듯 여기서 하나를 골라
 * 그 안에서 일한다 — 프로필·신청·가져오기·회원이 모두 고른 모임의 것만 보이고,
 * 새로 만드는 것도 그 모임으로 들어간다.
 *
 * **전체공개도 하나의 채널이다.** 소속 없는 프로필(`group_id IS NULL`)이 모이는 방이고
 * 모든 주선자가 본다. 모임이 하나도 없는 주선자는 이 방만 쓴다.
 *
 * 고르는 창은 화면 폭에 따라 다르다. 넓으면 버튼 아래 붙는 드롭다운이고, 좁으면
 * bottom sheet 다 — 이 버튼은 헤더 왼쪽에 있어서 좁은 화면에서 드롭다운을 붙이면
 * 어느 쪽에 맞춰도 화면 밖으로 나간다.
 */

export type GroupChoice = { id: string; name: string };

/** 전체공개 채널의 이름. 서버에서는 `groupId: null` 이다. */
const PUBLIC_LABEL = "전체공개";
const PUBLIC_HINT = "모든 주선자가 보는 방";

/** 드롭다운을 붙일 자리가 없는 폭. Tailwind `sm` 아래를 말한다. */
const NARROW = "(max-width: 639px)";

function useNarrowViewport() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return narrow;
}

export function GroupSwitcher({
  groups,
  activeGroupId,
}: {
  groups: GroupChoice[];
  activeGroupId: string | null;
}) {
  const router = useRouter();
  const narrow = useNarrowViewport();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 드롭다운만 바깥 클릭으로 닫는다. sheet 는 Dialog 가 배경막과 ESC 를 맡는다.
  useEffect(() => {
    if (!open || narrow) return;
    function onPointerDown(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, narrow]);

  const activeName = activeGroupId
    ? (groups.find((g) => g.id === activeGroupId)?.name ?? PUBLIC_LABEL)
    : PUBLIC_LABEL;

  async function switchTo(groupId: string | null) {
    setOpen(false);
    if (groupId === activeGroupId) return;
    setBusy(true);
    const result = await apiPut("/api/admin/groups/active", { groupId });
    setBusy(false);
    if (result.ok) router.refresh();
  }

  const items = (
    <>
      <ChannelItem
        label={PUBLIC_LABEL}
        hint={PUBLIC_HINT}
        active={activeGroupId == null}
        narrow={narrow}
        onSelect={() => void switchTo(null)}
      />
      {groups.map((group) => (
        <ChannelItem
          key={group.id}
          label={group.name}
          active={group.id === activeGroupId}
          narrow={narrow}
          onSelect={() => void switchTo(group.id)}
        />
      ))}
    </>
  );

  return (
    <div ref={boxRef} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full min-w-0 items-center gap-1.5 rounded-[var(--radius-pill)] sm:max-w-[220px]",
          "border border-[var(--surface-border)] bg-[var(--surface-card)] px-3 py-1.5",
          "text-[12.5px] text-[var(--color-ink-800)]",
          "transition-colors duration-[var(--duration-quick)] hover:border-[var(--color-rose-300)]",
          busy && "opacity-60",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            activeGroupId ? "bg-[var(--color-rose-600)]" : "bg-[var(--color-ink-500)]",
          )}
        />
        <span className="truncate">{activeName}</span>
        <Chevron />
      </button>

      {/* 열릴 때 비로소 마운트하면 Dialog 가 붙을 자리를 찾는 한 프레임이 비어 보인다. */}
      <Dialog
        open={open && narrow}
        onClose={() => setOpen(false)}
        label="보고 있는 모임 고르기"
        variant="sheet"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--surface-border)] px-5 py-3">
          <h2 className="display text-[15px] text-[var(--surface-text)]">보고 있는 모임</h2>
          <DialogClose onClose={() => setOpen(false)} />
        </header>
        <ul role="menu" className="min-h-0 flex-1 overflow-y-auto py-1">
          {items}
        </ul>
        <ManageLink
          onNavigate={() => setOpen(false)}
          className="px-5 py-4 text-[13.5px]"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        />
      </Dialog>

      {open && !narrow ? (
        <div
          role="menu"
          className={cn(
            "absolute left-0 top-full z-40 mt-1.5 w-64 overflow-hidden",
            "rounded-[var(--radius-card)] border border-[var(--surface-border)]",
            "bg-[var(--surface-card)] shadow-lg",
          )}
        >
          <p className="px-3 pb-1 pt-2.5 text-[11px] text-[var(--surface-text-muted)]">
            보고 있는 모임
          </p>
          <ul className="pb-1">{items}</ul>
          <ManageLink onNavigate={() => setOpen(false)} className="px-3 py-2.5 text-[12.5px]" />
        </div>
      ) : null}
    </div>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      className="ml-auto shrink-0 text-[var(--color-ink-500)]"
    >
      <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ManageLink({
  onNavigate,
  className,
  style,
}: {
  onNavigate: () => void;
  className: string;
  /** sheet 는 화면 맨 아래에 붙으므로 홈 인디케이터 자리를 비워 둔다. */
  style?: React.CSSProperties;
}) {
  return (
    <Link
      href="/group"
      onClick={onNavigate}
      style={style}
      className={cn(
        "block border-t border-[var(--surface-border)] text-[var(--color-rose-600)]",
        "transition-colors hover:bg-[var(--color-ivory-200)]",
        className,
      )}
    >
      모임 만들기 · 참여 · 설정
    </Link>
  );
}

function ChannelItem({
  label,
  hint,
  active,
  narrow,
  onSelect,
}: {
  label: string;
  hint?: string;
  active: boolean;
  /** sheet 에서는 손가락으로 누르므로 줄을 키우고 글씨를 올린다. */
  narrow: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={active}
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-2 text-left",
          "transition-colors duration-[var(--duration-quick)] hover:bg-[var(--color-ivory-200)]",
          narrow ? "px-5 py-3.5 text-[15px]" : "px-3 py-2 text-[13px]",
          active ? "text-[var(--color-rose-600)]" : "text-[var(--color-ink-800)]",
        )}
      >
        <span aria-hidden className={cn("shrink-0 text-[11px]", narrow ? "w-4" : "w-3")}>
          {active ? "●" : ""}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {hint ? (
          <span
            className={cn(
              "shrink-0 text-[var(--surface-text-muted)]",
              narrow ? "text-[12px]" : "text-[11px]",
            )}
          >
            {hint}
          </span>
        ) : null}
      </button>
    </li>
  );
}
