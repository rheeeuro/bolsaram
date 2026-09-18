import Link from "next/link";
import { ProfileCode } from "@/components/ui/marks";
import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

/**
 * 주선자 화면 공통 표면.
 *
 * 볼사람은 주선자를 위한 서비스이므로 이 화면들이 곧 제품이다 — 멤버 화면과 같은
 * warm ivory 바탕, serif display 제목, 부드러운 카드를 쓴다. 밀도가 필요한 곳
 * (Import 검토)에서만 안쪽 간격을 좁힌다.
 */

/**
 * 한 단계 들어간 화면의 위치 표시.
 *
 * 상세와 편집이 다른 주소로 갈렸으므로 지금 어디인지와 돌아갈 곳을 같은 모양으로
 * 말해야 한다. 공개 번호는 `code` 로 넘기면 본문과 같은 서체로 찍는다.
 */
export function Breadcrumb({
  items,
}: {
  items: { label?: string; code?: string; href?: string }[];
}) {
  return (
    <nav className="mb-5 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--surface-text-muted)]">
      {items.map((item, index) => {
        const body = item.code ? (
          <span className="display text-[13px] text-[var(--surface-text)]">
            <ProfileCode code={item.code} />
          </span>
        ) : (
          item.label
        );
        const last = index === items.length - 1;
        return (
          <span
            key={item.href ?? item.code ?? item.label ?? index}
            className="flex items-center gap-2"
          >
            {index > 0 ? <span aria-hidden>·</span> : null}
            {item.href ? (
              <Link href={item.href} className="hover:text-[var(--color-rose-600)]">
                {body}
              </Link>
            ) : (
              // 링크가 없는 마지막 칸이 지금 화면이다.
              <span {...(last ? { "aria-current": "page" as const } : {})}>{body}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export function PageHeader({
  kicker,
  title,
  description,
  aside,
}: {
  kicker?: string;
  title: string;
  description?: string;
  aside?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {kicker ? <p className="kicker mb-2">{kicker}</p> : null}
        <h1 className="display text-[26px] leading-tight text-[var(--surface-text)]">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-[var(--surface-text-muted)]">
            {description}
          </p>
        ) : null}
      </div>
      {aside ? <div className="flex items-center gap-3">{aside}</div> : null}
    </header>
  );
}

/** 목록 위에 붙는 건수 표시. 제목 옆에서 조용히 읽히게 둔다. */
export function Count({ children }: { children: ReactNode }) {
  return (
    <span className="text-[13px] text-[var(--surface-text-muted)]">{children}</span>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
  tight,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Import 검토처럼 정보량이 많은 곳에서 안쪽 간격을 좁힌다. */
  tight?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-[var(--radius-card)] border border-[var(--surface-border)]",
        "bg-[var(--surface-card)] shadow-[var(--shadow-card)]",
        className,
      )}
    >
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-[var(--surface-border)] px-5 py-3.5">
          <h2 className="display text-[15px] text-[var(--surface-text)]">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className={tight ? "p-4" : "p-5"}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  href,
  accent,
}: {
  label: string;
  value: number | string;
  hint?: string;
  href?: string;
  /** 지금 손이 가야 하는 숫자만 rose 로 칠한다. 전부 칠하면 아무것도 강조되지 않는다. */
  accent?: boolean;
}) {
  const body = (
    <>
      <p className="text-[12.5px] text-[var(--surface-text-muted)]">{label}</p>
      <p
        className={cn(
          "display mt-2 text-[32px] leading-none",
          accent ? "text-[var(--color-rose-600)]" : "text-[var(--surface-text)]",
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-2 text-[12px] text-[var(--surface-text-muted)]">{hint}</p>
      ) : null}
    </>
  );

  const shell = cn(
    "block rounded-[var(--radius-card)] border bg-[var(--surface-card)] px-5 py-4",
    "shadow-[var(--shadow-card)] transition-colors duration-[var(--duration-quick)]",
    accent ? "border-[var(--color-rose-200)]" : "border-[var(--surface-border)]",
    href ? "hover:border-[var(--color-rose-300)]" : "",
  );

  return href ? (
    <Link href={href} className={shell}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

/** 카드 안에서 항목을 세로로 쌓는 목록. 테이블 대신 쓴다. */
export function RowList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-[var(--surface-border)]">{children}</ul>;
}

export function Row({
  href,
  children,
  className,
}: {
  href?: string;
  children: ReactNode;
  className?: string;
}) {
  const inner = cn(
    "flex items-center gap-4 px-5 py-3.5 transition-colors duration-[var(--duration-quick)]",
    href ? "hover:bg-[var(--surface-muted)]" : "",
    className,
  );
  return (
    <li>
      {href ? (
        <Link href={href} className={inner}>
          {children}
        </Link>
      ) : (
        <div className={inner}>{children}</div>
      )}
    </li>
  );
}

/** 목록/카드용 사진 썸네일. 사진이 없어도 자리를 지켜 목록이 흔들리지 않게 한다. */
export function Thumb({
  url,
  size = "md",
}: {
  url: string | null | undefined;
  size?: "sm" | "md";
}) {
  return (
    <div
      className={cn(
        "shrink-0 overflow-hidden rounded-[10px] bg-[var(--color-ivory-200)]",
        size === "sm" ? "h-11 w-9" : "h-16 w-12",
      )}
    >
      {url ? (
        // signed URL 은 응답마다 새로 발급된다. next/image 최적화를 태우면 URL 이
        // 캐시되어 만료 뒤 깨지므로 img 를 그대로 쓴다.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : null}
    </div>
  );
}

/** 비어 있는 목록. 카드 안에 넣어 화면이 휑하지 않게 한다. */
export function Blank({ children }: { children: ReactNode }) {
  return (
    <p className="px-5 py-14 text-center text-[13.5px] text-[var(--surface-text-muted)]">
      {children}
    </p>
  );
}
