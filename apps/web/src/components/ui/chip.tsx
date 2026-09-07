"use client";

import { cn } from "@/lib/cn";

/** 필터 칩. 선택 상태를 색이 아니라 채움으로 구분해 색맹 접근성을 확보한다. */
export function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1.5 text-[13px] transition-colors",
        "duration-[var(--duration-quick)]",
        selected
          ? "border-[var(--color-rose-500)] bg-[var(--color-rose-500)] text-white"
          : "border-[var(--surface-border)] bg-white text-[var(--surface-text-muted)] hover:border-[var(--color-rose-300)]",
      )}
    >
      {label}
    </button>
  );
}
