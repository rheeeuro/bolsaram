import { cn } from "@/lib/cn";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const CONTROL = cn(
  "w-full rounded-xl border border-[var(--surface-border)] bg-white",
  "px-3 py-2 text-[14px] placeholder:text-[var(--color-ink-400)]",
  "transition-colors duration-[var(--duration-quick)]",
  "focus:border-[var(--color-rose-400)] focus:outline-none",
  "disabled:bg-[var(--surface-muted)] disabled:text-[var(--color-ink-500)]",
);

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <span className="mb-1.5 flex items-baseline gap-2">
      <span className="text-[13px] font-medium text-[var(--surface-text)]">{children}</span>
      {hint ? (
        <span className="text-[12px] text-[var(--surface-text-muted)]">{hint}</span>
      ) : null}
    </span>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block">
      {label ? <Label {...(hint ? { hint } : {})}>{label}</Label> : null}
      {children}
      {error ? (
        <span className="mt-1 block text-[12px] text-[var(--color-danger)]">{error}</span>
      ) : null}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(CONTROL, "min-h-24 resize-y", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(CONTROL, "appearance-none pr-8", className)} {...props} />;
}
