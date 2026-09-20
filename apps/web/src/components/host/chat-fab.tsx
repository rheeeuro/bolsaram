"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useChatStream } from "@/components/host/chat-stream";
import { HostNavIcon } from "@/components/host/host-nav-links";

/**
 * 오른쪽 아래 떠 있는 채팅 버튼.
 *
 * 채팅은 화면을 오가는 일이 아니라 **다른 일을 하다가 들르는 곳**이다. 프로필을
 * 보다가, 신청을 처리하다가 「방금 그 건 얘기해 두자」로 열린다. 그래서 내비게이션
 * 목록에서 빼고 어느 화면에서나 같은 자리에 띄운다 — 목록에 있으면 지금 보던 것을
 * 두고 탭을 옮겨야 하고, 좁은 화면에서는 다섯 칸 중 하나를 계속 차지한다.
 *
 * 버튼에 붙는 수는 **보고 있는 모임**의 안 읽은 글이다. 다른 모임 것은 위쪽 모임
 * 목록(그리고 모바일 상단 전환 버튼)이 알린다 — 여기서 합치면 눌러 들어갔을 때
 * 아무것도 새것이 없는 방이 열린다.
 *
 * 전체공개에는 방이 없고, 채팅 화면에 있을 때는 자기 자신을 가리키므로 그리지 않는다.
 */
export function HostChatFab({ activeGroupId }: { activeGroupId: string | null }) {
  const pathname = usePathname();
  const { unread } = useChatStream();

  if (!activeGroupId || pathname.startsWith("/chat")) return null;

  const count = unread[activeGroupId] ?? 0;
  const shown = count > 99 ? "99+" : String(count);

  return (
    <Link
      href="/chat"
      aria-label={count > 0 ? `모임 채팅 — 안 읽음 ${shown}개` : "모임 채팅"}
      className={cn(
        "host-fab fixed z-40 grid size-14 place-items-center rounded-full",
        "bg-[var(--color-rose-600)] text-white shadow-[var(--shadow-lift)]",
        "transition-transform duration-[var(--duration-quick)] hover:scale-105 active:scale-95",
      )}
    >
      <HostNavIcon name="/chat" />
      {count > 0 ? (
        <span
          className={cn(
            "absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-[var(--radius-pill)]",
            "border-2 border-[var(--color-ivory-50)] bg-[var(--color-burgundy-900)] px-1",
            "text-[10px] font-medium leading-none",
          )}
        >
          {shown}
        </span>
      ) : null}
    </Link>
  );
}
