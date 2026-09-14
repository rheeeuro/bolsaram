"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { GroupMessagePayload, GroupMessageSystemKind } from "@bolsaram/schemas";
import { apiGet, apiPatch } from "@/lib/api-client";

/**
 * 채팅 실시간 연결 (SSE).
 *
 * 주선자 영역 전체를 감싼다. **연결은 하나다** — 상단 배지는 보고 있지 않은 방도
 * 알아야 하고, 방마다 열면 모임이 늘수록 연결이 늘어난다. 채팅 화면은 이 연결에
 * 얹혀서 자기 방의 글만 골라 쓴다.
 *
 * 끊기면 `EventSource` 가 스스로 다시 붙고 마지막으로 받은 `id`(= 그 글의 작성 시각)를
 * `Last-Event-ID` 로 보낸다. 서버가 그 뒤의 것을 메워 주므로 끊긴 동안의 글을 잃지
 * 않는다. 다시 붙을 때마다 안 읽은 수를 한 번 맞춘다 — 이벤트로 세는 값이 조금씩
 * 어긋나도 여기서 정돈된다.
 */

export type ChatMessage = {
  id: string;
  groupId: string;
  authorUserId: string | null;
  /** 작성자 이름. 계정이 지워졌으면 null 이다. */
  authorName: string | null;
  body: string;
  /** 서버에서 ISO 문자열로 내려온다 — 재연결 커서로 그대로 쓴다. */
  createdAt: string;
  deleted: boolean;
  /** 사람이 쓴 글이면 null. 값이 있으면 DB 가 남긴 사건이다(0044). */
  systemKind: GroupMessageSystemKind | null;
  payload: GroupMessagePayload;
};

export type ChatEvent = { kind: "message" | "deleted"; message: ChatMessage };

type ChatStreamValue = {
  unread: Record<string, number>;
  /** 지금 화면에 열려 있는 방. 그 방의 새 글은 안 읽음으로 세지 않는다. */
  setViewing: (groupId: string | null) => void;
  /** 새 글·지운 글을 받는다. 반환한 함수로 구독을 끊는다. */
  subscribe: (handler: (event: ChatEvent) => void) => () => void;
  /** 여기까지 읽었다고 서버에 남기고 배지를 내린다. */
  markRead: (groupId: string, at: string) => void;
};

const ChatStreamContext = createContext<ChatStreamValue | null>(null);

/** 같은 글을 두 번 세지 않기 위해 기억하는 개수. 재연결이 겹칠 때를 위한 것이다. */
const SEEN_LIMIT = 200;

export function ChatStreamProvider({
  initialUnread,
  since,
  viewerId,
  children,
}: {
  initialUnread: Record<string, number>;
  /** 서버가 안 읽은 수를 센 시각. 화면이 뜨고 연결되기까지의 틈을 이 값으로 메운다. */
  since: string;
  viewerId: string;
  children: ReactNode;
}) {
  const [unread, setUnread] = useState(initialUnread);

  const handlersRef = useRef(new Set<(event: ChatEvent) => void>());
  const viewingRef = useRef<string | null>(null);
  const seenRef = useRef<string[]>([]);
  /** 마지막으로 받은 글의 시각. 첫 연결에서만 쓴다(재연결은 브라우저가 헤더로 보낸다). */
  const cursorRef = useRef(since);

  const subscribe = useCallback((handler: (event: ChatEvent) => void) => {
    const handlers = handlersRef.current;
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }, []);

  const setViewing = useCallback((groupId: string | null) => {
    viewingRef.current = groupId;
  }, []);

  const markRead = useCallback((groupId: string, at: string) => {
    setUnread((prev) => (prev[groupId] ? { ...prev, [groupId]: 0 } : prev));
    void apiPatch(`/api/admin/groups/${groupId}/chat`, { readUpTo: at });
  }, []);

  useEffect(() => {
    const source = new EventSource(`/api/admin/chat/stream?after=${encodeURIComponent(since)}`);

    /** 다시 붙을 때마다 정확한 값으로 맞춘다. 이벤트로 센 값이 어긋나도 여기서 정돈된다. */
    async function resync() {
      const result = await apiGet<{ groups: { groupId: string; unread: number }[] }>(
        "/api/admin/chat",
      );
      if (result.ok) {
        setUnread(Object.fromEntries(result.data.groups.map((g) => [g.groupId, g.unread])));
      }
    }

    function handle(kind: ChatEvent["kind"], raw: MessageEvent<string>) {
      let message: ChatMessage;
      try {
        message = JSON.parse(raw.data) as ChatMessage;
      } catch {
        return;
      }
      cursorRef.current = message.createdAt;

      // 재연결이 겹치면 같은 글이 두 번 올 수 있다. 목록은 id 로 접히지만 배지는
      // 세는 값이라 여기서 한 번 걸러야 한다.
      const first = !seenRef.current.includes(message.id);
      if (first) {
        seenRef.current.push(message.id);
        if (seenRef.current.length > SEEN_LIMIT) seenRef.current.shift();
      }

      for (const handler of handlersRef.current) handler({ kind, message });

      const mine = message.authorUserId === viewerId;
      const watching = viewingRef.current === message.groupId;
      if (kind === "message" && first && !mine && !watching) {
        setUnread((prev) => ({ ...prev, [message.groupId]: (prev[message.groupId] ?? 0) + 1 }));
      }
    }

    source.addEventListener("message", (event) => handle("message", event as MessageEvent<string>));
    source.addEventListener("deleted", (event) => handle("deleted", event as MessageEvent<string>));
    source.addEventListener("open", () => void resync());
    // 오류는 브라우저가 재연결로 처리한다. 상태를 흔들지 않는다.

    return () => source.close();
  }, [since, viewerId]);

  const value = useMemo<ChatStreamValue>(
    () => ({ unread, setViewing, subscribe, markRead }),
    [unread, setViewing, subscribe, markRead],
  );

  return <ChatStreamContext.Provider value={value}>{children}</ChatStreamContext.Provider>;
}

export function useChatStream(): ChatStreamValue {
  const value = useContext(ChatStreamContext);
  if (!value) throw new Error("ChatStreamProvider 안에서만 쓸 수 있습니다.");
  return value;
}
