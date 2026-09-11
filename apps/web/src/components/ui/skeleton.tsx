import { cn } from "@/lib/cn";

/**
 * 자리를 먼저 잡아두는 회색 블록.
 *
 * 화면이 비어 있는 동안 아무것도 그리지 않으면 탭을 눌러도 반응이 없는 것처럼 보인다.
 * 실제 내용과 같은 크기·개수로 놓아야 채워질 때 화면이 튀지 않는다.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded bg-[var(--color-ivory-200)]", className)}
    />
  );
}

/**
 * 불러오는 중임을 화면을 보지 않는 사용자에게도 알린다.
 * 스켈레톤은 `aria-hidden` 이라 이것이 없으면 아무 말도 하지 않는다.
 */
export function LoadingLabel({ children = "불러오는 중" }: { children?: string }) {
  return (
    <span role="status" className="sr-only">
      {children}
    </span>
  );
}
