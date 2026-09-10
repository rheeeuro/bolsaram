import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-[var(--color-rose-600)] text-white hover:bg-[var(--color-burgundy-700)] active:bg-[var(--color-burgundy-800)] disabled:bg-[var(--color-ink-300)]",
  secondary:
    "bg-white text-[var(--surface-text)] border border-[var(--surface-border)] hover:bg-[var(--surface-muted)]",
  ghost: "text-[var(--surface-text-muted)] hover:bg-[var(--surface-muted)]",
  danger:
    "bg-white text-[var(--color-danger)] border border-[var(--color-danger)]/30 hover:bg-[var(--color-danger)]/8",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] rounded-lg",
  md: "h-10 px-4 text-[14px] rounded-xl",
  lg: "h-12 px-5 text-[15px] rounded-xl",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
};

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 font-medium",
        "transition-colors duration-[var(--duration-quick)]",
        "disabled:cursor-not-allowed disabled:opacity-60",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
