import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * 주선자 화면 `loading.tsx` 가 쓰는 자리 잡기 블록.
 * 테두리·안쪽 간격·제목 줄 높이를 `Panel`·`PageHeader`·`Breadcrumb` 와 맞춘다 —
 * 다르면 채워질 때 화면이 튄다.
 */

/** `PageHeader` 자리. 제목 26px 한 줄과 설명 한 줄. */
export function PageHeaderSkeleton({ aside = false }: { aside?: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <Skeleton className="h-8 w-28" />
        <Skeleton className="mt-2.5 h-4 w-72 max-w-full" />
      </div>
      {aside ? <Skeleton className="h-5 w-12" /> : null}
    </div>
  );
}

/** `Breadcrumb` 자리. */
export function BreadcrumbSkeleton() {
  return (
    <div className="mb-5 flex items-center gap-2">
      <Skeleton className="h-4 w-12" />
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

/** `Panel` 껍데기. 제목이 있으면 머리 줄을 같은 높이로 둔다. */
export function PanelSkeleton({
  title = true,
  tight = false,
  className,
  children,
}: {
  title?: boolean;
  tight?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border border-[var(--surface-border)] bg-[var(--surface-card)]",
        className,
      )}
    >
      {title ? (
        <div className="border-b border-[var(--surface-border)] px-5 py-3.5">
          <Skeleton className="h-5 w-24" />
        </div>
      ) : null}
      <div className={tight ? "p-4" : "p-5"}>{children}</div>
    </div>
  );
}

/** 라벨과 입력칸 한 쌍. 폼 패널 안을 채운다. */
export function FieldSkeleton() {
  return (
    <div>
      <Skeleton className="h-3.5 w-14" />
      <Skeleton className="mt-1.5 h-10 w-full rounded-xl" />
    </div>
  );
}
