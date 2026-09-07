import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

/** 관리자 테이블. 밀도를 높이고 장식을 줄인다. */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)]">
      <table className="w-full min-w-max border-collapse text-[13px]">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "border-b border-[var(--surface-border)] px-3 py-2.5 text-left",
        "text-[12px] font-medium text-[var(--surface-text-muted)]",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td
      className={cn(
        "border-b border-[var(--surface-border)] px-3 py-2.5 align-middle",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Card({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)]">
      {title ? (
        <header className="flex items-center justify-between border-b border-[var(--surface-border)] px-4 py-3">
          <h2 className="text-[13.5px] font-medium">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)] px-4 py-3.5">
      <p className="text-[12px] text-[var(--surface-text-muted)]">{label}</p>
      <p className="mt-1 text-[24px] font-semibold leading-none tracking-tight">{value}</p>
      {hint ? (
        <p className="mt-1.5 text-[11.5px] text-[var(--surface-text-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}
