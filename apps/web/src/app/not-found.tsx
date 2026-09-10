/** 없는 주소. 비공개 서비스라 무엇이 없는지는 말하지 않는다. */
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="member-surface flex min-h-dvh flex-col items-center justify-center bg-[var(--color-ivory-50)] px-8 text-center">
      <p className="kicker">PAGE NOT FOUND</p>
      <h1 className="display mt-4 text-[26px] leading-tight text-[var(--color-ink-900)]">
        찾을 수 없는 페이지예요
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-ink-700)]">
        주소가 바뀌었거나, 볼 수 있는 권한이 없는 페이지입니다.
      </p>
      <Link
        href="/"
        className="mt-8 rounded-xl bg-[var(--color-rose-600)] px-6 py-3 text-[14px] font-medium text-white transition-colors hover:bg-[var(--color-burgundy-700)]"
      >
        처음으로
      </Link>
    </main>
  );
}
