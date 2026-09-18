import Link from "next/link";
import { formatHashtag } from "@bolsaram/schemas";
import { cn } from "@/lib/cn";

/**
 * 멤버 번호는 `17번`, 해시태그는 `#등산` 이다. **기호는 해시태그만 쓴다** — 둘 다 기호로
 * 시작하면 한눈에 갈리지 않는다. 종류는 앞에 붙는 아이콘이 말한다(번호는 사람, 태그는 라벨).
 *
 * 아이콘 크기를 `em` 으로 두어 어디에 놓든 옆 글자를 따라간다.
 */

export function PersonIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="0.85em"
      height="0.85em"
      fill="none"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <circle cx="10" cy="6.5" r="3.2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3.8 17c0-3.4 2.8-5.6 6.2-5.6s6.2 2.2 6.2 5.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function TagIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="0.85em"
      height="0.85em"
      fill="none"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <path
        d="M10.4 2.6H16a1.4 1.4 0 0 1 1.4 1.4v5.6a1.4 1.4 0 0 1-.41.99l-6.6 6.6a1.4 1.4 0 0 1-1.98 0l-5.6-5.6a1.4 1.4 0 0 1 0-1.98l6.6-6.6a1.4 1.4 0 0 1 .99-.41Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="13.4" cy="6.6" r="1.25" fill="currentColor" />
    </svg>
  );
}

/**
 * 멤버 번호 표기. `code` 는 이미 `17번` 형태다(`formatPublicCode`).
 * 읽어 주는 이름을 함께 달아 화면 낭독기에서도 태그와 섞이지 않는다.
 */
export function ProfileCode({ code, className }: { code: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <PersonIcon className="opacity-60" />
      <span>
        <span className="sr-only">멤버 번호 </span>
        {code}
      </span>
    </span>
  );
}

/**
 * 해시태그 칩. `href` 를 주면 그 태그로 모아 보는 링크가 되고,
 * `onRemove` 를 주면 조건에서 빼는 버튼이 된다(둘 다 없으면 표시만 한다).
 */
export function HashtagChip({
  tag,
  href,
  onRemove,
  className,
}: {
  tag: string;
  href?: string;
  onRemove?: () => void;
  className?: string;
}) {
  const shape = cn(
    "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[13px]",
    "border-[var(--color-rose-300)] bg-[var(--color-rose-100)] text-[var(--color-rose-600)]",
    "transition-colors duration-[var(--duration-quick)]",
    className,
  );
  const body = (
    <>
      <TagIcon className="opacity-70" />
      <span>
        <span className="sr-only">해시태그 </span>
        {formatHashtag(tag)}
      </span>
    </>
  );

  if (onRemove) {
    return (
      <button
        type="button"
        onClick={onRemove}
        aria-label={`해시태그 ${formatHashtag(tag)} 빼기`}
        className={cn(shape, "border-[var(--color-rose-400)]")}
      >
        {body}
        <span aria-hidden>×</span>
      </button>
    );
  }
  if (href) {
    return (
      <Link href={href} className={cn(shape, "hover:border-[var(--color-rose-500)]")}>
        {body}
      </Link>
    );
  }
  return <span className={shape}>{body}</span>;
}
