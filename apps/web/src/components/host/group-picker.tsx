"use client";

import { Menu, MenuItem } from "@/components/ui/menu";
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

/**
 * 같은 값을 고르는 드롭다운.
 *
 * 알약 줄(`GroupPicker`)은 방이 몇 개일 때 한눈에 보여서 좋지만, 모임이 늘면 여러 줄로
 * 번져 폼 한 칸이 화면을 다 먹는다. **한 번 정해 두고 오래 쓰는 값**은 접히는 이쪽을
 * 쓴다 — 고르는 순간 저장되는 것은 양쪽이 같다.
 *
 * native `<select>` 대신 `Menu` 로 그린다. 브라우저가 그리는 목록은 우리 팔레트·서체가
 * 닿지 않아 주선자 화면 안에서 혼자 운영 도구처럼 보인다. 키보드(↑↓·ESC)와 바깥 클릭,
 * 지금 값 체크 표시는 `Menu` 가 맡는다.
 */
export function GroupDropdown({
  groups,
  value,
  onChange,
  disabled = false,
  className,
}: {
  groups: GroupChoice[];
  value: string | null;
  onChange: (groupId: string | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const currentName = groups.find((group) => group.id === value)?.name ?? PUBLIC_GROUP_LABEL;

  return (
    <Menu
      label="업로드할 모임 고르기"
      disabled={disabled}
      className={className}
      trigger={(open) => (
        <span
          className={cn(
            "flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2 text-[14px]",
            "transition-colors duration-[var(--duration-quick)]",
            disabled
              ? "border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--color-ink-500)]"
              : open
                ? "border-[var(--color-rose-400)] bg-white text-[var(--surface-text)]"
                : "border-[var(--surface-border)] bg-white text-[var(--surface-text)] hover:border-[var(--color-rose-300)]",
          )}
        >
          <span className="min-w-0 flex-1 truncate">{currentName}</span>
          <Chevron open={open} />
        </span>
      )}
    >
      <MenuItem checked={value == null} onSelect={() => onChange(null)}>
        {PUBLIC_GROUP_LABEL}
      </MenuItem>
      {groups.map((group) => (
        <MenuItem
          key={group.id}
          checked={group.id === value}
          onSelect={() => onChange(group.id)}
        >
          {group.name}
        </MenuItem>
      ))}
    </Menu>
  );
}

/** 열리면 위를 가리킨다 — 목록이 아래로 펼쳐지므로 방향이 상태를 말한다. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={cn(
        "shrink-0 text-[var(--surface-text-muted)] transition-transform duration-[var(--duration-quick)]",
        open && "rotate-180",
      )}
    >
      <path
        d="M5.5 8l4.5 4.5L14.5 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
