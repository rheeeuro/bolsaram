"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { apiPut } from "@/lib/api-client";
import { cn } from "@/lib/cn";

export type GroupChoice = { id: string; name: string };

/** 항상 보이는 모임 목록. 전환 완료까지 중복 요청을 막는다. */
export function GroupSwitcher({
  groups,
  activeGroupId,
  unread,
}: {
  groups: GroupChoice[];
  activeGroupId: string | null;
  unread: Record<string, number>;
}) {
  const router = useRouter();
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function switchTo(groupId: string | null) {
    if (locked.current || pending || groupId === activeGroupId) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    const result = await apiPut("/api/admin/groups/active", { groupId });
    if (result.ok) startTransition(() => router.refresh());
    else setError(result.message);
    locked.current = false;
    setBusy(false);
  }

  return (
    <section
      aria-label="내 모임"
      aria-busy={busy || pending}
      className="min-h-0 lg:flex lg:flex-col"
    >
      <p className="mb-2 px-2 text-[11px] font-medium tracking-wider text-[var(--surface-text-muted)]">
        내 모임
      </p>
      <div className="flex gap-2 overflow-x-auto pb-2 lg:max-h-[32dvh] lg:flex-col lg:overflow-y-auto">
        {[{ id: null, name: "전체공개" }, ...groups].map((group) => {
          const active = group.id === activeGroupId;
          const count = group.id ? (unread[group.id] ?? 0) : 0;
          return (
            <button
              key={group.id ?? "public"}
              type="button"
              aria-pressed={active}
              title={group.name}
              disabled={busy || pending}
              onClick={() => void switchTo(group.id)}
              className={cn(
                "flex min-h-12 shrink-0 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-60 lg:shrink",
                active
                  ? "border-[var(--color-rose-300)] bg-[var(--color-rose-600)]/10 text-[var(--color-rose-600)]"
                  : "border-transparent hover:bg-[var(--color-ivory-200)]",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold",
                  active
                    ? "bg-[var(--color-rose-600)] text-white"
                    : "bg-[var(--color-ivory-200)] text-[var(--color-ink-600)]",
                )}
              >
                {group.id ? Array.from(group.name)[0] : "◎"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block max-w-40 truncate text-[13px] font-medium lg:max-w-none">
                  {group.name}
                </span>
                <span className="hidden text-[11px] text-[var(--surface-text-muted)] lg:block">
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
        <Link
          href="/group"
          className="flex min-h-12 shrink-0 items-center gap-2 rounded-xl px-3 text-[12px] text-[var(--surface-text-muted)] hover:bg-[var(--color-ivory-200)]"
        >
          <span aria-hidden className="text-xl">
            ＋
          </span>{" "}
          모임 만들기 · 참여
        </Link>
      </div>
      {(busy || pending) && (
        <p role="status" className="px-2 text-xs text-[var(--surface-text-muted)]">
          모임으로 이동 중…
        </p>
      )}
      {error && (
        <p role="alert" className="px-2 text-xs text-[var(--color-rose-600)]">
          {error}
        </p>
      )}
    </section>
  );
}
