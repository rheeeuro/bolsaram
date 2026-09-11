import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * 회원 화면 상단 바와, 그 아래 붙는 sticky 하위 바.
 *
 * 둘을 한 파일에 두는 이유는 높이 계약을 공유하기 때문이다. 헤더는 제목이 로고든
 * 글자든 `--member-header-h` 로 높이를 고정하고, 하위 바는 같은 변수를 읽어 붙는다.
 * 각자 숫자를 들고 있으면 헤더 안의 글자 크기가 조금만 달라져도 사이가 벌어지거나
 * 하위 바가 헤더 밑으로 밀려 들어간다.
 */
export function MemberHeader({
  title,
  back,
  action,
}: {
  /** 로고를 쓰는 화면이 있어서 노드로 받는다. 문자열이면 serif display 로 그린다. */
  title: ReactNode;
  /** 돌아갈 곳. 하단 탭에 없는 화면(숨긴 사람)만 쓴다. */
  back?: { href: string; label: string };
  /** 오른쪽 끝에 붙는 것. */
  action?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--surface-border)] bg-[var(--surface-page)]/95 backdrop-blur">
      {/* 아래 테두리까지 합쳐 --member-header-h 가 되게 한다. */}
      <div className="mx-auto flex h-[calc(var(--member-header-h)-1px)] max-w-3xl items-center gap-3 px-4">
        {back ? (
          <Link
            href={back.href}
            aria-label={back.label}
            className="-ml-2.5 grid h-11 w-11 shrink-0 place-items-center rounded-full"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path
                d="M12 4 6 10l6 6"
                stroke="var(--color-ink-900)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        ) : null}

        {typeof title === "string" ? (
          <h1 className="display text-[22px] leading-none text-[var(--color-ink-900)]">
            {title}
          </h1>
        ) : (
          <h1 className="flex items-center">{title}</h1>
        )}

        {action ? <div className="ml-auto flex shrink-0 items-center">{action}</div> : null}
      </div>
    </header>
  );
}

/**
 * 헤더 바로 아래에 붙는 sticky 바(성별 탭·시그널 탭).
 * 좌우 여백이 `px-4` 인 본문 안에서 쓰는 것을 전제로 `-mx-4` 로 폭을 되돌린다.
 */
export function MemberSubBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky top-[var(--member-header-h)] z-10 -mx-4 flex items-center gap-2",
        "bg-[var(--surface-page)]/95 px-4 py-3 backdrop-blur",
        className,
      )}
    >
      {children}
    </div>
  );
}
