"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
 */

export type GroupChoice = { id: string; name: string };

/** 전체공개 채널의 이름. 서버에서는 `groupId: null` 이다. */
const PUBLIC_LABEL = "전체공개";

export function GroupSwitcher({
  groups,
  activeGroupId,
}: {
  groups: GroupChoice[];
  activeGroupId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 바깥을 누르거나 Esc 로 닫는다. 메뉴가 열린 채로 화면을 가리지 않게 한다.
  useEffect(() => {
    if (!open) return;
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
  }, [open]);

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

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex max-w-[190px] items-center gap-1.5 rounded-[var(--radius-pill)]",
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
        <span aria-hidden className="text-[10px] text-[var(--color-ink-500)]">
          ▼
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute right-0 z-40 mt-1.5 w-60 overflow-hidden",
            "rounded-[var(--radius-card)] border border-[var(--surface-border)]",
            "bg-[var(--surface-card)] shadow-lg",
          )}
        >
          <p className="px-3 pb-1 pt-2.5 text-[11px] text-[var(--surface-text-muted)]">
            보고 있는 모임
          </p>
          <ul className="pb-1">
            <ChannelItem
              label={PUBLIC_LABEL}
              hint="모든 주선자가 보는 방"
              active={activeGroupId == null}
              onSelect={() => void switchTo(null)}
            />
            {groups.map((group) => (
              <ChannelItem
                key={group.id}
                label={group.name}
                active={group.id === activeGroupId}
                onSelect={() => void switchTo(group.id)}
              />
            ))}
          </ul>
          <Link
            href="/group"
            onClick={() => setOpen(false)}
            className="block border-t border-[var(--surface-border)] px-3 py-2.5 text-[12.5px] text-[var(--color-rose-600)] transition-colors hover:bg-[var(--color-ivory-200)]"
          >
            모임 만들기 · 참여 · 설정
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function ChannelItem({
  label,
  hint,
  active,
  onSelect,
}: {
  label: string;
  hint?: string;
  active: boolean;
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
          "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]",
          "transition-colors duration-[var(--duration-quick)] hover:bg-[var(--color-ivory-200)]",
          active ? "text-[var(--color-rose-600)]" : "text-[var(--color-ink-800)]",
        )}
      >
        <span aria-hidden className="w-3 shrink-0 text-[11px]">
          {active ? "●" : ""}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {hint ? (
          <span className="shrink-0 text-[11px] text-[var(--surface-text-muted)]">{hint}</span>
        ) : null}
      </button>
    </li>
  );
}
