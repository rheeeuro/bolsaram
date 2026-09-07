import type { ReactNode } from "react";

/** 빈 상태. 무엇이 없는지와 다음 행동을 같이 보여준다. */
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-[15px] text-[var(--surface-text)]">{title}</p>
      {description ? (
        <p className="max-w-xs text-[13px] leading-relaxed text-[var(--surface-text-muted)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
