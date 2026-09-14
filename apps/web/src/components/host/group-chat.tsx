"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GROUP_MESSAGE_MAX_LENGTH } from "@bolsaram/schemas";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { useChatStream, type ChatMessage } from "@/components/host/chat-stream";
import { Button } from "@/components/ui/button";
import { FormError, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { groupSystemMessageText } from "@/lib/labels";

/**
 * 모임 채팅방 (마이그레이션 0040).
 *
 * 주선자끼리 쓰는 운영 채널이라 메신저처럼 꾸미지 않는다 — 같은 warm ivory 표면에
 * 말풍선 대신 줄을 쌓는다. 내가 쓴 것만 색을 달리해 눈으로 구분한다.
 *
 * 새 글은 **서버가 밀어준다**(`ChatStreamProvider` 의 SSE 연결). 이 화면은 그 연결에
 * 얹혀 자기 방의 것만 골라 쓰고, 열려 있는 동안 「이 방을 보고 있다」고 알려 둔다 —
 * 그래야 보고 있는 방의 글이 안 읽음으로 세어지지 않는다.
 *
 * 모임에서 일어난 일(입장·퇴장·회원 등록·신청·연결)도 같은 줄기에 섞여 내려온다.
 * 그것은 말이 아니라 사건이므로 가운데 한 줄로 조용히 흐르게 둔다.
 *
 * 보이는 범위는 **들어온 시점부터**다(0045). 화면이 자르는 것이 아니라 정책이 막으므로
 * 여기서는 따로 다루지 않는다 — 새로 합류한 사람에게는 자기 입장 기록이 첫 줄이 된다.
 */

export type { ChatMessage };

export function GroupChat({
  groupId,
  viewerId,
  initialMessages,
  telegramNotify,
}: {
  groupId: string;
  viewerId: string;
  initialMessages: ChatMessage[];
  telegramNotify: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notify, setNotify] = useState(telegramNotify);
  const [olderDone, setOlderDone] = useState(initialMessages.length === 0);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const { subscribe, setViewing, markRead } = useChatStream();

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  /** 이미 읽음으로 찍은 시각. 같은 값을 두 번 보내지 않는다. */
  const markedRef = useRef<string | null>(null);

  const latestAt = messages.length > 0 ? messages[messages.length - 1]!.createdAt : null;

  /**
   * 새 메시지만 덧붙인다. 보낸 직후의 응답과 곧이어 오는 스트림 이벤트가 같은 글을
   * 가리키므로 id 로 접는다 — 보낸 사람에게는 응답이 먼저 닿아 바로 보인다.
   */
  const append = useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const added = incoming.filter((m) => !seen.has(m.id));
      if (added.length === 0) return prev;
      // 보낸 직후의 응답과 밀려오는 사건이 뒤섞일 수 있으므로 시각으로 정렬해 둔다.
      return [...prev, ...added].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }, []);

  // 이 방을 보고 있다고 알린다. 나가면 해제한다.
  useEffect(() => {
    setViewing(groupId);
    return () => setViewing(null);
  }, [groupId, setViewing]);

  // 서버가 밀어주는 글을 받는다. 다른 방의 것은 상단 배지가 쓰고 여기서는 버린다.
  useEffect(
    () =>
      subscribe((event) => {
        if (event.message.groupId !== groupId) return;
        if (event.kind === "deleted") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === event.message.id ? { ...m, body: "", deleted: true } : m,
            ),
          );
          return;
        }
        append([event.message]);
      }),
    [groupId, subscribe, append],
  );

  // 새 메시지가 쌓이면 바닥으로 따라가고 읽음을 찍는다.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
    if (latestAt && markedRef.current !== latestAt) {
      markedRef.current = latestAt;
      markRead(groupId, latestAt);
    }
  }, [groupId, latestAt, markRead]);

  async function loadOlder() {
    const oldest = messages[0]?.createdAt;
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    const result = await apiGet<{ messages: ChatMessage[] }>(
      `/api/admin/groups/${groupId}/messages?before=${encodeURIComponent(oldest)}`,
    );
    setLoadingOlder(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (result.data.messages.length === 0) {
      setOlderDone(true);
      return;
    }
    // 위쪽에 붙이므로 스크롤 위치를 건드리지 않는다.
    setMessages((prev) => [...result.data.messages, ...prev]);
  }

  async function send() {
    const body = draft.trim();
    if (body.length === 0 || sending) return;
    setSending(true);
    setError(null);
    const result = await apiPost<{ message: ChatMessage }>(
      `/api/admin/groups/${groupId}/messages`,
      { body },
    );
    setSending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDraft("");
    append([result.data.message]);
  }

  async function remove(id: string) {
    const result = await apiDelete(`/api/admin/groups/${groupId}/messages/${id}`);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, body: "", deleted: true } : m)),
    );
  }

  async function toggleNotify() {
    const next = !notify;
    setNotify(next);
    const result = await apiPatch(`/api/admin/groups/${groupId}/chat`, { telegramNotify: next });
    if (!result.ok) {
      setNotify(!next);
      setError(result.message);
    }
  }

  return (
    <div className="grid max-w-3xl gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-[var(--surface-text-muted)]">
          지운 메시지는 자리만 남고 내용은 사라집니다. 고칠 수는 없습니다.
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-[var(--surface-text-muted)]">
          <input
            type="checkbox"
            checked={notify}
            onChange={() => void toggleNotify()}
            className="h-3.5 w-3.5 accent-[var(--color-rose-600)]"
          />
          새 글을 텔레그램으로도 받기
        </label>
      </div>

      <div
        ref={scrollRef}
        className={cn(
          "flex h-[58vh] min-h-80 flex-col gap-0.5 overflow-y-auto",
          "rounded-[var(--radius-card)] border border-[var(--surface-border)]",
          "bg-[var(--surface-card)] px-4 py-4 shadow-[var(--shadow-card)]",
        )}
      >
        {messages.length === 0 ? (
          <p className="m-auto text-[13.5px] text-[var(--surface-text-muted)]">
            아직 대화가 없습니다. 첫 줄을 남겨 보세요.
          </p>
        ) : (
          <>
            {olderDone ? (
              <p className="pb-3 text-center text-[12px] text-[var(--surface-text-muted)]">
                더 이전 대화는 없습니다
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="mb-2 self-center text-[12.5px] text-[var(--surface-text-muted)] underline-offset-4 hover:underline disabled:opacity-60"
              >
                {loadingOlder ? "불러오는 중…" : "이전 대화 보기"}
              </button>
            )}
            {messages.map((message, index) =>
              message.systemKind ? (
                <SystemRow key={message.id} message={{ ...message, systemKind: message.systemKind }} />
              ) : (
                <MessageRow
                  key={message.id}
                  message={message}
                  mine={message.authorUserId === viewerId}
                  /** 같은 사람이 이어 쓰면 이름을 반복하지 않는다. */
                  grouped={isGrouped(messages[index - 1], message)}
                  onDelete={() => void remove(message.id)}
                />
              ),
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      <FormError>{error}</FormError>

      <div className="flex items-end gap-2">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter 로 보내고 Shift+Enter 로 줄을 바꾼다. 조합 중(한글)에는 보내지 않는다.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
          maxLength={GROUP_MESSAGE_MAX_LENGTH}
          rows={2}
          placeholder="메시지를 입력하세요. Enter 로 보내고 Shift+Enter 로 줄을 바꿉니다."
          className="min-h-[52px] flex-1"
        />
        <Button onClick={() => void send()} disabled={sending || draft.trim().length === 0}>
          보내기
        </Button>
      </div>
    </div>
  );
}

/**
 * 모임에서 일어난 일. 말풍선도 이름도 없이 가운데 한 줄로 흐른다 — 읽히되 대화를
 * 끊지 않는 자리다. 지울 수 없으므로 지우기 버튼도 없다.
 */
function SystemRow({
  message,
}: {
  message: ChatMessage & { systemKind: NonNullable<ChatMessage["systemKind"]> };
}) {
  return (
    <div className="flex items-center gap-2.5 px-1 py-2">
      <span aria-hidden className="h-px flex-1 bg-[var(--surface-border)]" />
      <span className="text-center text-[12px] leading-relaxed text-[var(--surface-text-muted)]">
        {groupSystemMessageText(message.systemKind, message.payload)}
        <time dateTime={message.createdAt} className="ml-1.5 text-[11px] opacity-80">
          {formatTime(message.createdAt)}
        </time>
      </span>
      <span aria-hidden className="h-px flex-1 bg-[var(--surface-border)]" />
    </div>
  );
}

/** 같은 사람이 5분 안에 이어 쓴 줄인가. 이름과 시각을 반복하지 않기 위한 판정이다. */
function isGrouped(previous: ChatMessage | undefined, current: ChatMessage): boolean {
  // 사건이 끼면 흐름이 끊긴 것이다 — 다음 줄은 이름을 다시 보여준다.
  if (!previous || previous.systemKind || previous.authorUserId !== current.authorUserId) {
    return false;
  }
  const gap = new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime();
  return gap < 5 * 60_000;
}

function MessageRow({
  message,
  mine,
  grouped,
  onDelete,
}: {
  message: ChatMessage;
  mine: boolean;
  grouped: boolean;
  onDelete: () => void;
}) {
  return (
    <div className={cn("group px-1", grouped ? "pt-0.5" : "pt-3")}>
      {grouped ? null : (
        <div className="flex items-baseline gap-2">
          <span className="text-[12.5px] font-medium text-[var(--surface-text)]">
            {mine ? "나" : (message.authorName ?? "나간 주선자")}
          </span>
          <time
            dateTime={message.createdAt}
            className="text-[11.5px] text-[var(--surface-text-muted)]"
          >
            {formatTime(message.createdAt)}
          </time>
        </div>
      )}

      <div className="flex items-start gap-2">
        {message.deleted ? (
          <p className="text-[13.5px] italic text-[var(--surface-text-muted)]">
            지운 메시지입니다.
          </p>
        ) : (
          <p
            className={cn(
              "whitespace-pre-wrap break-words text-[13.5px] leading-relaxed",
              mine ? "text-[var(--color-burgundy-700)]" : "text-[var(--surface-text)]",
            )}
          >
            {message.body}
          </p>
        )}
        {mine && !message.deleted ? (
          <button
            type="button"
            onClick={onDelete}
            className="shrink-0 text-[11.5px] text-[var(--surface-text-muted)] opacity-0 transition-opacity hover:text-[var(--color-danger)] focus-visible:opacity-100 group-hover:opacity-100"
          >
            지우기
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** 오늘이면 시각만, 다른 날이면 날짜까지. 운영 대화라 초는 보이지 않는다. */
function formatTime(iso: string): string {
  const at = new Date(iso);
  const today = new Date();
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate();
  return at.toLocaleString("ko-KR", {
    ...(sameDay ? {} : { month: "numeric", day: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}
