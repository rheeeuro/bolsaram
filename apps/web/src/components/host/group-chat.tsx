"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  GROUP_CHAT_NOTIFY_LABELS,
  GROUP_CHAT_NOTIFY_MODES,
  GROUP_MESSAGE_MAX_LENGTH,
  type GroupChatNotifyMode,
} from "@bolsaram/schemas";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { useChatStream, type ChatMessage } from "@/components/host/chat-stream";
import {
  MENTION_COLORS,
  MentionInputMirror,
  MentionText,
  useMentionPicker,
} from "@/components/host/chat-mention";
import { Avatar } from "@/components/ui/avatar";
import { FormError } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import {
  GROUP_SYSTEM_MESSAGE_TAGS,
  groupSystemMessageParts,
  type GroupSystemMessageTone,
} from "@/lib/labels";

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
 * 모임에서 일어난 일(입장·퇴장·멤버 등록·신청·연결)도 같은 줄기에 섞여 내려온다.
 * 그것은 말이 아니라 사건이므로 가운데 한 줄로 조용히 흐르게 둔다. 거기 적힌 멤버
 * 번호는 그 프로필로 가는 링크다 — 사건을 읽고 바로 그 사람을 열어 보는 자리다.
 *
 * 멘션은 두 가지다(`chat-mention.tsx`). `@이름` 은 이 모임 주선자, `#23` 은 이 모임
 * 멤버다. 입력란에서 `@`·`#` 를 치면 그 목록이 뜨고, 보낸 글의 멤버 멘션은 그 프로필로
 * 가는 링크가 된다.
 *
 * 보이는 범위는 **들어온 시점부터**다(0045). 화면이 자르는 것이 아니라 정책이 막으므로
 * 여기서는 따로 다루지 않는다 — 새로 합류한 사람에게는 자기 입장 기록이 첫 줄이 된다.
 *
 * `compact` 는 오른쪽 아래 떠 있는 패널(`HostChatPanel`) 안에 들어갈 때의 배치다.
 * 패널이 이미 카드이므로 테두리를 두르지 않고 주어진 높이를 채운다.
 */

export type { ChatMessage };

export function GroupChat({
  groupId,
  viewerId,
  initialMessages,
  notify: initialNotify,
  telegramLinked,
  compact = false,
}: {
  groupId: string;
  viewerId: string;
  initialMessages: ChatMessage[];
  notify: GroupChatNotifyMode;
  telegramLinked: boolean;
  compact?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notify, setNotify] = useState(initialNotify);
  const [olderDone, setOlderDone] = useState(initialMessages.length === 0);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const { subscribe, setViewing, markRead } = useChatStream();

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const mention = useMentionPicker({ groupId, value: draft, setValue: setDraft, inputRef });
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

  // 패널은 열자마자 쓰는 곳이다. 넓은 화면에서만 입력칸에 커서를 둔다 — 폰에서는
  // 키보드가 올라와 읽으려던 대화를 가린다.
  useEffect(() => {
    if (compact && window.matchMedia("(min-width: 1024px)").matches) inputRef.current?.focus();
  }, [compact]);

  // 새 메시지가 쌓이면 바닥으로 따라가고 읽음을 찍는다. 떠 있는 패널은 자기 안에서만
  // 내린다 — `scrollIntoView` 는 뒤에 깔린 화면까지 움직인다.
  useEffect(() => {
    if (compact) {
      const box = scrollRef.current;
      if (box) box.scrollTop = box.scrollHeight;
    } else {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
    if (latestAt && markedRef.current !== latestAt) {
      markedRef.current = latestAt;
      markRead(groupId, latestAt);
    }
  }, [compact, groupId, latestAt, markRead]);

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

  async function changeNotify(next: GroupChatNotifyMode) {
    const previous = notify;
    setNotify(next);
    const result = await apiPatch(`/api/admin/groups/${groupId}/chat`, { notify: next });
    if (!result.ok) {
      setNotify(previous);
      setError(result.message);
    }
  }


  return (
    <div className={compact ? "flex h-full min-h-0 flex-col" : "grid max-w-3xl gap-3"}>
      <div
        className={cn(
          "flex flex-wrap items-center gap-2",
          compact
            ? "justify-end border-b border-[var(--surface-border)] px-4 py-2"
            : "justify-between",
        )}
      >
        {compact ? null : (
          <p className="text-[12.5px] text-[var(--surface-text-muted)]">
            지운 메시지는 자리만 남고 내용은 사라집니다. 고칠 수는 없습니다.
          </p>
        )}
        {/* 텔레그램을 연결해야 보낼 곳이 생긴다. 그 전에는 고르지 않고 연결로 안내한다. */}
        {telegramLinked ? (
          <label className="flex items-center gap-2 text-[12.5px] text-[var(--surface-text-muted)]">
            텔레그램 알림
            <select
              value={notify}
              onChange={(event) => void changeNotify(event.target.value as GroupChatNotifyMode)}
              className="rounded-lg border border-[var(--surface-border)] bg-white py-1 pl-2 pr-6 text-[12.5px] text-[var(--surface-text)]"
            >
              {GROUP_CHAT_NOTIFY_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {GROUP_CHAT_NOTIFY_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <Link
            href="/account"
            className="text-[12.5px] text-[var(--surface-text-muted)] underline-offset-4 hover:text-[var(--color-rose-600)] hover:underline"
          >
            텔레그램을 연결하면 알림을 받습니다 →
          </Link>
        )}
      </div>

      <div
        ref={scrollRef}
        className={cn(
          "flex flex-col gap-0.5 overflow-y-auto overscroll-contain",
          compact
            ? "min-h-0 flex-1 px-4 py-3"
            : [
                "h-[58vh] min-h-80",
                "rounded-[var(--radius-card)] border border-[var(--surface-border)]",
                "bg-[var(--surface-card)] px-4 py-4 shadow-[var(--shadow-card)]",
              ],
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
                  viewerId={viewerId}
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

      {compact ? (
        error ? (
          <div className="px-4 pb-1">
            <FormError>{error}</FormError>
          </div>
        ) : null
      ) : (
        <FormError>{error}</FormError>
      )}

      {/* 입력칸과 보내기를 한 상자에 담는다. 글은 위에 쓰고, 아래 줄 오른쪽 끝에서 보낸다. */}
      <div className={cn(compact && "border-t border-[var(--surface-border)] p-3")}>
        <div
          className={cn(
            "relative rounded-2xl border border-[var(--surface-border)] bg-white px-3.5 pb-2 pt-3",
            "transition-colors duration-[var(--duration-quick)]",
            // 안쪽 입력칸의 포커스 링을 지운 대신 상자가 포커스를 드러낸다.
            "focus-within:border-[var(--color-rose-400)] focus-within:ring-1 focus-within:ring-[var(--color-rose-400)]",
          )}
        >
          {mention.list}
          {/* 입력창 글자는 투명하고, 뒤의 층이 같은 글을 그려 멘션에 색을 입힌다. 두 층의
              글꼴·줄 간격·줄바꿈이 같아야 커서가 글자 위에 맞는다. */}
          <div className="relative">
            <MentionInputMirror
              value={draft}
              hostNames={mention.hostNames}
              mirrorRef={mirrorRef}
              className={cn("absolute inset-0", INPUT_TEXT, "text-[var(--surface-text)]")}
            />
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                mention.sync();
              }}
              onSelect={() => mention.sync()}
              onBlur={() => mention.close()}
              onScroll={(event) => {
                // 길어져 입력창 안에서 스크롤되면 뒤의 층도 같은 만큼 올린다.
                if (mirrorRef.current) mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
              }}
              onKeyDown={(event) => {
                // 멘션 목록이 열려 있으면 ↑↓·Enter·Tab·Esc 는 목록이 먼저 쓴다.
                if (mention.onKeyDown(event)) return;
                // Enter 로 보내고 Shift+Enter 로 줄을 바꾼다. 조합 중(한글)에는 보내지 않는다.
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              maxLength={GROUP_MESSAGE_MAX_LENGTH}
              rows={2}
              aria-label="메시지"
              placeholder="메시지를 입력하세요. @주선자 · #멤버 번호로 멘션합니다"
              className={cn(
                "no-scrollbar relative block max-h-40 min-h-12 w-full resize-none bg-transparent field-sizing-content",
                INPUT_TEXT,
                "text-transparent caret-[var(--surface-text)] placeholder:text-[var(--color-ink-500)]",
                "focus-visible:outline-none",
              )}
            />
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-[11.5px] text-[var(--surface-text-muted)]">
              Enter 보내기 · Shift+Enter 줄바꿈 ·{" "}
              <span className={cn("rounded-[3px] px-0.5", MENTION_COLORS.host)}>@주선자</span>{" "}
              <span className={cn("rounded-[3px] px-0.5", MENTION_COLORS.member)}>#멤버</span>
            </p>
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || draft.trim().length === 0}
              aria-label="보내기"
              title="보내기"
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-full",
                "bg-[var(--color-rose-600)] text-white",
                "transition-colors duration-[var(--duration-quick)] enabled:hover:bg-[var(--color-burgundy-700)]",
                "disabled:bg-[var(--surface-muted)] disabled:text-[var(--color-ink-500)]",
              )}
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
                <path
                  d="M10 15.5v-11M5.5 9 10 4.5 14.5 9"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 모임에서 일어난 일. 말풍선도 이름도 없이 가운데 한 줄로 흐른다 — 읽히되 대화를
 * 끊지 않는 자리다. 지울 수 없으므로 지우기 버튼도 없다.
 *
 * 갈래(주선자·멤버·신청·연결)마다 옅은 색 테두리와 꼬리표를 달아 종류가 한눈에
 * 갈린다. 바탕은 아주 옅게만 물들여 사람의 글보다 앞에 나서지 않게 한다.
 *
 * 멤버 번호는 그 프로필로 가는 링크가 된다. 볼 수 없는 번호(지워졌거나 담당 채널을
 * 벗어난 것)는 id 가 오지 않으므로 글자로만 남는다 — 죽은 링크를 만들지 않는다.
 */
function SystemRow({
  message,
}: {
  message: ChatMessage & { systemKind: NonNullable<ChatMessage["systemKind"]> };
}) {
  const { tag, tone } = GROUP_SYSTEM_MESSAGE_TAGS[message.systemKind];
  return (
    <div
      className="animate-fade flex items-center gap-2.5 px-1 py-2"
      style={{ "--tone": SYSTEM_TONE_COLORS[tone] } as React.CSSProperties}
    >
      <span aria-hidden className="h-px min-w-3 flex-1 bg-[var(--surface-border)]" />
      <span
        className={cn(
          "inline-flex max-w-[92%] flex-wrap items-baseline justify-center gap-x-1.5 gap-y-0.5",
          "rounded-full border px-2.5 py-1 text-center text-[12px] leading-relaxed",
          "border-[color-mix(in_srgb,var(--tone)_22%,transparent)]",
          "bg-[color-mix(in_srgb,var(--tone)_5%,white)] text-[var(--color-ink-600)]",
        )}
      >
        <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--tone)_14%,white)] px-1.5 text-[11px] font-semibold text-[var(--tone)]">
          {tag}
        </span>
        <span>
          {groupSystemMessageParts(message.systemKind, message.payload).map((part, index) => {
            const profileId = part.kind === "code" && part.code != null
              ? message.profileIds[String(part.code)]
              : undefined;
            if (!profileId) return <span key={index}>{part.text}</span>;
            return (
              <Link
                key={index}
                href={`/profiles/${profileId}`}
                className="font-medium text-[var(--surface-text)] underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--color-rose-600)]"
              >
                <span className="sr-only">멤버 번호 </span>
                {part.text}
              </Link>
            );
          })}
        </span>
        <time
          dateTime={message.createdAt}
          className="shrink-0 text-[11px] text-[var(--surface-text-muted)]"
        >
          {formatTime(message.createdAt)}
        </time>
      </span>
      <span aria-hidden className="h-px min-w-3 flex-1 bg-[var(--surface-border)]" />
    </div>
  );
}

/** 사건 갈래의 색. 주선자·멤버는 멘션 색(`MENTION_COLORS`)과 같은 계열이다. */
const SYSTEM_TONE_COLORS: Record<GroupSystemMessageTone, string> = {
  host: "var(--color-info)",
  member: "var(--color-rose-600)",
  request: "var(--color-warning)",
  match: "var(--color-success)",
};

/** 입력창과 그 뒤의 층이 함께 쓰는 글자 모양. 한쪽만 바꾸면 커서가 글자와 어긋난다. */
const INPUT_TEXT = "whitespace-pre-wrap break-words text-[14px] leading-relaxed";

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
  viewerId,
  grouped,
  onDelete,
}: {
  message: ChatMessage;
  mine: boolean;
  viewerId: string;
  grouped: boolean;
  onDelete: () => void;
}) {
  return (
    <div className={cn("animate-enter group flex gap-2.5 px-1", grouped ? "pt-0.5" : "pt-3")}>
      {/* 이어 쓴 줄은 사진 자리를 비워 둔다 — 글의 왼쪽 끝이 한 줄로 맞는다. */}
      <div className="w-8 shrink-0">
        {grouped ? null : (
          <Avatar
            src={message.authorAvatarUrl}
            name={message.authorName}
            className="mt-0.5 grid size-8 place-items-center rounded-full bg-[var(--color-ivory-200)] text-[12px] font-semibold text-[var(--color-ink-600)]"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
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
              <MentionText
                body={message.body}
                profileIds={message.profileIds}
                hostIds={message.hostIds}
                viewerId={viewerId}
              />
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
