"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";

/**
 * 사이드바의 「○○ 님」 — 계정 설정(`/account`)으로 들어가는 자리.
 *
 * 이름은 카카오·구글이 준 값으로 시작하지만 그 뒤로는 본인이 정한다. 제공자 쪽에서
 * 닉네임을 바꿔도 여기는 따라가지 않으므로 바꿀 길이 화면에 있어야 하고, 그 길이
 * 이 줄이다. 이름만 고치는 창이 아니라 **계정 화면 전체**로 가므로 톱니 아이콘을
 * 붙여 「설정으로 간다」를 드러낸다.
 *
 * 모임 목록 위에 있다 — 계정은 모임과 무관하고, 아래 화면 목록은 모두 모임 안의
 * 것이기 때문이다.
 */
export function AccountName({
  displayName,
  avatarUrl,
}: {
  displayName: string | null;
  /** 프로필 사진의 단기 signed URL. 없으면 이름의 앞글자를 그린다. */
  avatarUrl: string | null;
}) {
  const pathname = usePathname();
  const active = pathname.startsWith("/account");
  const current = displayName ?? "주선자";

  return (
    <Link
      href="/account"
      aria-current={active ? "page" : undefined}
      title={`${current} 님 — 계정 설정`}
      className={cn(
        "group flex min-h-9 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 py-1",
        "transition-colors duration-[var(--duration-quick)]",
        active
          ? "bg-[var(--color-rose-600)]/10 text-[var(--color-rose-600)]"
          : "text-[var(--surface-text-muted)] hover:bg-[var(--color-ivory-200)] hover:text-[var(--surface-text)]",
      )}
    >
      <Avatar
        src={avatarUrl}
        name={current}
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold",
          active
            ? "bg-[var(--color-rose-600)] text-white"
            : "bg-[var(--color-ivory-200)] text-[var(--color-ink-600)]",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-[12.5px]">{current} 님</span>
      <GearIcon
        className={cn(
          "shrink-0 transition-opacity duration-[var(--duration-quick)]",
          active ? "opacity-100" : "opacity-45 group-hover:opacity-100",
        )}
      />
    </Link>
  );
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M10 2.6v1.8M10 15.6v1.8M3.8 10H2m16 0h-1.8M5.6 5.6 4.3 4.3m11.4 11.4-1.3-1.3M5.6 14.4l-1.3 1.3M15.7 4.3l-1.3 1.3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
