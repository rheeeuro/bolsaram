"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { GroupChatNotifyMode } from "@bolsaram/schemas";
import { apiGet } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { GroupChat, type ChatMessage } from "@/components/host/group-chat";

/**
 * 오른쪽 아래에 떠 있는 채팅 패널.
 *
 * 채팅은 하던 일 옆에 잠깐 여는 곳이라, 화면을 옮기지 않고 지금 보던 것 위에 띄운다.
 * 뒤를 가리는 덮개를 깔지 않는다 — 패널을 연 채로 프로필을 넘기고 신청을 처리한다.
 * 길게 이야기할 때는 「크게 보기」로 채팅 화면(`/chat`)에 들어간다.
 *
 * 열 때마다 그 방의 최근 글을 새로 받는다. 그 뒤의 새 글은 `GroupChat` 이 스트림에서
 * 받는다. 모임을 바꾸면 `key` 가 바뀌어 그 방으로 다시 열린다.
 */
export function HostChatPanel({
  groupId,
  groupName,
  viewerId,
  onClose,
}: {
  groupId: string;
  groupName: string;
  viewerId: string;
  onClose: () => void;
}) {
  // Esc 로 닫는다. 입력 중인 한글 조합을 끊지 않게 조합 중에는 무시한다.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // 입력란의 멘션 목록이 먼저 Esc 를 쓰면(defaultPrevented) 패널은 그대로 둔다.
      if (event.key === "Escape" && !event.isComposing && !event.defaultPrevented) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section
      role="dialog"
      aria-label={`${groupName} 채팅`}
      className={cn(
        "host-chat-panel animate-enter fixed z-40 flex flex-col overflow-hidden",
        "rounded-[var(--radius-card)] border border-[var(--surface-border)]",
        "bg-[var(--surface-card)] shadow-[var(--shadow-lift)]",
      )}
    >
      <header className="flex items-center gap-1 border-b border-[var(--surface-border)] py-2 pl-4 pr-2">
        <div className="min-w-0 flex-1">
          <p className="kicker-ko leading-none">채팅</p>
          <h2 className="display mt-1 truncate text-[17px] leading-tight">{groupName}</h2>
        </div>
        <Link
          href="/chat"
          onClick={onClose}
          aria-label="채팅 크게 보기"
          title="크게 보기"
          className={ICON_BUTTON}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path
              d="M11.5 4.5h4v4M8.5 15.5h-4v-4M15.5 4.5 11 9M4.5 15.5 9 11"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
        <button type="button" onClick={onClose} aria-label="채팅 닫기" title="닫기" className={ICON_BUTTON}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <PanelRoom key={groupId} groupId={groupId} viewerId={viewerId} />
    </section>
  );
}

const ICON_BUTTON = cn(
  "grid size-9 shrink-0 place-items-center rounded-full text-[var(--surface-text-muted)]",
  "transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--surface-text)]",
);

type Loaded = {
  messages: ChatMessage[];
  notify: GroupChatNotifyMode;
  telegramLinked: boolean;
};

/** 방 하나의 첫 화면을 받아 채팅을 그린다. 받는 동안과 실패를 패널 안에서 보여준다. */
function PanelRoom({ groupId, viewerId }: { groupId: string; viewerId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [list, prefs] = await Promise.all([
        apiGet<{ messages: ChatMessage[] }>(`/api/admin/groups/${groupId}/messages`),
        apiGet<{ notify: GroupChatNotifyMode; telegramLinked: boolean }>(
          `/api/admin/groups/${groupId}/chat`,
        ),
      ]);
      if (cancelled) return;
      if (!list.ok) return setError(list.message);
      if (!prefs.ok) return setError(prefs.message);
      setLoaded({
        messages: list.data.messages,
        notify: prefs.data.notify,
        telegramLinked: prefs.data.telegramLinked,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId, attempt]);

  if (loaded) {
    return (
      <div className="min-h-0 flex-1">
        <GroupChat
          compact
          groupId={groupId}
          viewerId={viewerId}
          initialMessages={loaded.messages}
          notify={loaded.notify}
          telegramLinked={loaded.telegramLinked}
        />
      </div>
    );
  }

  return (
    <div className="grid flex-1 place-items-center px-6 text-center">
      {error ? (
        <div className="grid gap-2">
          <p className="text-[13.5px] text-[var(--color-danger)]">{error}</p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
            className="text-[12.5px] text-[var(--surface-text-muted)] underline underline-offset-4"
          >
            다시 불러오기
          </button>
        </div>
      ) : (
        <p className="text-[13px] text-[var(--surface-text-muted)]">불러오는 중…</p>
      )}
    </div>
  );
}
