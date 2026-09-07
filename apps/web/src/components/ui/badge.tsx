import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

type Tone = "neutral" | "active" | "warning" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-[var(--surface-muted)] text-[var(--surface-text-muted)]",
  active: "bg-[var(--color-success)]/12 text-[var(--color-success)]",
  warning: "bg-[var(--color-warning)]/14 text-[var(--color-warning)]",
  danger: "bg-[var(--color-danger)]/12 text-[var(--color-danger)]",
  info: "bg-[var(--color-info)]/12 text-[var(--color-info)]",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[12px] font-medium",
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/** 상태 문자열 → 배지 톤. 화면마다 다르게 칠하지 않도록 한 곳에 모은다. */
export function toneForStatus(status: string): Tone {
  switch (status) {
    case "ACTIVE":
    case "ACCEPTED":
    case "READY":
    case "IMPORTED":
      return "active";
    case "MATCHING":
    case "INTRODUCED":
      return "info";
    case "REVIEW_REQUIRED":
    case "REQUESTED":
    case "PAUSED":
    case "ANALYZING":
      return "warning";
    case "FAILED":
    case "REJECTED":
      return "danger";
    default:
      return "neutral";
  }
}
