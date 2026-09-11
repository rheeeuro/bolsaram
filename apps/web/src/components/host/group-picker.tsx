"use client";

import { cn } from "@/lib/cn";

/**
 * 어느 모임(방)에 넣을지 고르는 알약 줄.
 *
 * 가져올 때와 검토할 때 같은 것을 고르므로 한 컴포넌트를 나눠 쓴다.
 * **전체공개도 하나의 방으로 보여준다** — 값으로는 `null` 이지만 주선자에게는
 * 「소속 없음」이 아니라 「모든 주선자가 보는 방」이다.
 */

export type GroupChoice = { id: string; name: string };

/** 전체공개 채널의 이름. 서버에서는 `groupId: null` 이다. */
export const PUBLIC_GROUP_LABEL = "전체공개";

export function GroupPicker({
  groups,
  value,
  onChange,
  disabled = false,
  /**
   * 전체공개를 고를 수 있는가.
   *
   * 검토 화면에서 쓴다 — 이미 모임에 들어간 것을 전체공개로 되돌리는 것은 정책상
   * 그 건을 가져온 주선자만 할 수 있다(`import_sessions_admin` 의 WITH CHECK).
   */
  allowPublic = true,
}: {
  groups: GroupChoice[];
  value: string | null;
  onChange: (groupId: string | null) => void;
  disabled?: boolean;
  allowPublic?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pill
        label={PUBLIC_GROUP_LABEL}
        active={value == null}
        disabled={disabled || (!allowPublic && value != null)}
        onSelect={() => onChange(null)}
      />
      {groups.map((group) => (
        <Pill
          key={group.id}
          label={group.name}
          active={group.id === value}
          disabled={disabled}
          onSelect={() => onChange(group.id)}
        />
      ))}
    </div>
  );
}

function Pill({
  label,
  active,
  disabled,
  onSelect,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "max-w-[200px] truncate rounded-[var(--radius-pill)] px-3 py-1.5 text-[12.5px]",
        "transition-colors duration-[var(--duration-quick)]",
        active
          ? "bg-[var(--color-rose-600)] text-white"
          : "border border-[var(--surface-border)] bg-[var(--surface-card)] text-[var(--color-ink-700)] hover:border-[var(--color-rose-300)]",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {label}
    </button>
  );
}
