/**
 * 채팅 변화 구독 (마이그레이션 0043).
 *
 * DB 트리거가 `pg_notify` 로 흘리는 사건을 프로세스 안에서 나눠 준다. 커넥션 하나가
 * 채널을 듣고, 열려 있는 SSE 연결들이 여기에 붙는다 — 연결마다 커넥션을 잡으면
 * 주선자가 늘어날수록 커넥션이 늘어난다.
 *
 * **여기로 오는 사건에는 권한이 없다.** 모든 방의 것이 그대로 지나가므로, 받는 쪽이
 * 자기 RLS 컨텍스트로 메시지를 다시 읽어 판정을 받아야 한다(`/api/admin/chat/stream`).
 * 이 파일은 내용을 읽지 않는다.
 */
import "server-only";
import { listen, type Listener } from "@bolsaram/db";
import { groupChatNotifySchema, type GroupChatNotify } from "@bolsaram/schemas";

/** DB 쪽 채널 이름. 0043 의 `pg_notify` 와 같아야 한다. */
const CHANNEL = "bolsaram_group_chat";

type Handler = (event: GroupChatNotify) => void;

type Hub = { subscribers: Set<Handler>; listener: Listener | null };

// Next dev 의 모듈 재평가에서 커넥션이 중복 생성되지 않도록 전역에 붙인다(커넥션 풀과 같은 이유).
const globalForHub = globalThis as typeof globalThis & { __bolsaramChatHub?: Hub };

function hub(): Hub {
  globalForHub.__bolsaramChatHub ??= { subscribers: new Set(), listener: null };
  return globalForHub.__bolsaramChatHub;
}

function ensureListening(): void {
  const current = hub();
  if (current.listener) return;
  current.listener = listen(CHANNEL, (payload) => {
    let event: GroupChatNotify;
    try {
      event = groupChatNotifySchema.parse(JSON.parse(payload));
    } catch {
      // 형식이 맞지 않는 payload 는 버린다. 내용을 로그에 남기지 않는다.
      console.error("채팅 이벤트 payload 를 해석하지 못했습니다.");
      return;
    }
    for (const handler of current.subscribers) {
      try {
        handler(event);
      } catch (error) {
        // 한 연결이 실패해도 나머지는 계속 받는다.
        console.error("채팅 이벤트 처리 실패:", error instanceof Error ? error.message : error);
      }
    }
  });
}

/**
 * 사건을 받는다. 반환한 함수를 부르면 구독이 끝난다 — SSE 연결이 닫힐 때 반드시 부른다.
 * 첫 구독자가 생길 때 채널을 듣기 시작한다.
 */
export function subscribeGroupChat(handler: Handler): () => void {
  ensureListening();
  const current = hub();
  current.subscribers.add(handler);
  return () => {
    current.subscribers.delete(handler);
  };
}
