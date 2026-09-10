import { cn } from "@/lib/cn";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const CONTROL = cn(
  "w-full rounded-xl border border-[var(--surface-border)] bg-white",
  "px-3 py-2 text-[14px] placeholder:text-[var(--color-ink-500)]",
  "transition-colors duration-[var(--duration-quick)]",
  // outline-none 을 두면 globals.css 의 :focus-visible 링을 덮는다
  // (utilities 레이어가 base 를 이긴다). 테두리 색만으로는 키보드 위치를
  // 알 수 없어 링을 그대로 살린다.
  "focus:border-[var(--color-rose-400)]",
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
        <span role="alert" className="mt-1 block text-[12px] text-[var(--color-danger)]">
          {error}
        </span>
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

/**
 * 폼 전체에 대한 오류. 특정 입력에 붙지 않는 실패(인증 거절·시도 제한 등)에 쓴다.
 * `role="alert"` 로 두어 화면을 보지 않는 사용자에게도 실패가 전달되게 한다.
 */
export function FormError({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-[13px] leading-relaxed text-[var(--color-danger)]">
      {children}
    </p>
  );
}
