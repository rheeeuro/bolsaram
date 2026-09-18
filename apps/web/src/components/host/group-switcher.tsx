"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuItem } from "@/components/ui/menu";
import { GroupCreateDialogs } from "@/components/host/group-create";
import { useGroupSwitch } from "@/components/host/use-group-switch";

export type GroupChoice = {
  id: string;
  name: string;
  /** 모임 사진의 단기 signed URL. 없으면 이름의 앞글자를 그린다. */
  imageUrl: string | null;
};

/**
 * 사이드바에 항상 펼쳐져 있는 모임 목록. 좁은 화면에서는 대신 상단의 모임 시트를 쓴다.
 *
 * 여기서 하는 일은 **어느 방을 볼지 고르는 것과 방을 늘리는 것** 둘뿐이다. 고른
 * 모임을 고치는 일은 아래 이름 옆 메뉴에서 그 모임 안으로 들어간다 — 목록에 설정을
 * 섞으면 어느 모임을 건드리는지가 목록 위치에 숨는다.
 */
export function GroupSwitcher({
  groups,
  activeGroupId,
  unread,
}: {
  groups: GroupChoice[];
  activeGroupId: string | null;
  unread: Record<string, number>;
}) {
  const { switchTo, busy, error } = useGroupSwitch(activeGroupId);
  const [dialog, setDialog] = useState<"create" | "join" | null>(null);

  return (
    <section aria-label="내 모임" aria-busy={busy} className="flex min-h-0 flex-col">
      <div className="mb-2 px-2">
        <p className="text-[11px] font-medium tracking-wider text-[var(--surface-text-muted)]">
          내 모임
        </p>
      </div>
      <div className="flex max-h-[32dvh] flex-col gap-2 overflow-y-auto pb-2">
        {[{ id: null, name: "전체공개", imageUrl: null }, ...groups].map((group) => {
          const active = group.id === activeGroupId;
          const count = group.id ? (unread[group.id] ?? 0) : 0;
          return (
            <button
              key={group.id ?? "public"}
              type="button"
              aria-pressed={active}
              title={group.name}
              disabled={busy}
              onClick={() => void switchTo(group.id)}
              className={cn(
                "flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-60",
                active
                  ? "border-[var(--color-rose-300)] bg-[var(--color-rose-600)]/10 text-[var(--color-rose-600)]"
                  : "border-transparent hover:bg-[var(--color-ivory-200)]",
              )}
            >
              <Avatar
                src={group.imageUrl}
                name={group.name}
                fallback={group.id ? undefined : "◎"}
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold",
                  active
                    ? "bg-[var(--color-rose-600)] text-white"
                    : "bg-[var(--color-ivory-200)] text-[var(--color-ink-600)]",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{group.name}</span>
                <span className="block text-[11px] text-[var(--surface-text-muted)]">
                  {group.id ? "함께하는 모임" : "모든 주선자의 공간"}
                </span>
              </span>
              {count > 0 && (
                <span className="rounded-full bg-[var(--color-rose-600)] px-1.5 text-[11px] text-white">
                  {count > 99 ? "99+" : count}
                  <span className="sr-only">개 안 읽음</span>
                </span>
              )}
            </button>
          );
        })}
        <Menu
          label="모임 추가"
          className="shrink-0"
          panelClassName="min-w-52"
          trigger={(open) => (
            <span
              className={cn(
                "flex min-h-12 items-center gap-2 rounded-xl px-3 text-[12px] text-[var(--surface-text-muted)] transition-colors",
                open ? "bg-[var(--color-ivory-200)]" : "hover:bg-[var(--color-ivory-200)]",
              )}
            >
              <span aria-hidden className="text-xl">
                ＋
              </span>{" "}
              모임 만들기 · 참여하기
            </span>
          )}
        >
          <MenuItem onSelect={() => setDialog("create")}>새 모임 만들기</MenuItem>
          <MenuItem onSelect={() => setDialog("join")}>초대 코드로 참여</MenuItem>
        </Menu>
      </div>
      {busy && (
        <p role="status" className="px-2 text-xs text-[var(--surface-text-muted)]">
          모임으로 이동 중…
        </p>
      )}
      {error && (
        <p role="alert" className="px-2 text-xs text-[var(--color-rose-600)]">
          {error}
        </p>
      )}

      <GroupCreateDialogs which={dialog} onClose={() => setDialog(null)} />
    </section>
  );
}
