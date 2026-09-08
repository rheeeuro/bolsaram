import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND } from "@bolsaram/ui-tokens";

/**
 * 로그인·입장·가입·초대 확인 화면의 공용 껍데기.
 *
 * 네 화면의 헤더 구성이 제각각이면 같은 서비스로 읽히지 않는다. 브랜드 → 화면 제목 →
 * 설명 순서를 여기서 한 번만 정하고, 각 화면은 폼과 하단 안내만 채운다.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  /** 폼이 없는 화면(안내만 남은 실패 화면)도 있으므로 없을 수 있다. */
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="member-surface flex min-h-dvh flex-col bg-[var(--color-ivory-50)]">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-7 py-12">
        <header className="mb-8">
          <Link
            href="/"
            className="display text-[19px] leading-none text-[var(--color-ink-700)] transition-colors hover:text-[var(--color-ink-900)]"
          >
            {BRAND.nameKo}
          </Link>
          <h1 className="display mt-7 text-[27px] leading-tight text-[var(--color-ink-900)]">
            {title}
          </h1>
          {description ? (
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-[var(--color-ink-600)]">
              {description}
            </p>
          ) : null}
        </header>

        {children}

        {footer ? <div className="mt-8 flex flex-col gap-2.5">{footer}</div> : null}

        {/* 무엇을 모으는지는 들어오기 전에 읽을 수 있어야 한다. */}
        <p className="mt-10 text-[12px] text-[var(--color-ink-500)]">
          <Link href="/privacy" className="underline">
            개인정보 처리방침
          </Link>
        </p>
      </div>
    </main>
  );
}

/** 화면 아래쪽의 다른 경로 안내. 한 줄, 밑줄 링크 하나. */
export function AuthFooterLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children?: ReactNode;
}) {
  return (
    <p className="text-[13px] leading-relaxed text-[var(--color-ink-600)]">
      {children}{" "}
      <Link href={href} className="text-[var(--color-rose-600)] underline">
        {label}
      </Link>
    </p>
  );
}
