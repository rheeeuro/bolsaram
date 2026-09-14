/**
 * 채팅 실시간 스트림 (SSE).
 *
 * 화면이 주기적으로 묻는 대신 서버가 밀어준다. WebSocket 이 아니라 SSE 인 이유 —
 * Route Handler 는 업그레이드를 지원하지 않아 WS 를 쓰려면 커스텀 서버를 띄워야 하고
 * (Next 문서 `backend-for-frontend` 「Deployment environment」), 채팅 **쓰기는 이미
 * POST** 라 서버→클라이언트 한 방향이면 충분하다. 끊기면 브라우저가 알아서 다시 붙고
 * `Last-Event-ID` 로 놓친 구간을 말해 준다.
 *
 * 연결 하나가 **내가 속한 모든 방**의 사건을 받는다. 방마다 열면 모임이 늘수록 연결이
 * 늘고, 상단 배지는 보고 있지 않은 방도 알아야 한다.
 *
 * ── 권한 ─────────────────────────────────────────────────────
 * DB 가 알리는 사건에는 권한이 없다(0043). 그래서 **보내기 직전에 그 사용자의 RLS
 * 컨텍스트로 메시지를 다시 읽는다** — 속하지 않은 방의 사건은 빈 결과가 되어 나가지
 * 않는다. 모임에서 나간 뒤에도 연결이 살아 있는 경우가 여기서 막힌다.
 */
import { NextResponse } from "next/server";
import { withRls } from "@bolsaram/db";
import { GROUP_MESSAGE_PAGE_SIZE } from "@bolsaram/schemas";
import { requireAdmin, rlsContextOf, type Viewer } from "@/server/auth/guard";
import { subscribeGroupChat } from "@/server/chat/broadcast";
import { listMessagesSince, readMessage } from "@/server/repo/group-chat";
import { route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

/** 주석 한 줄을 흘려 연결을 살려 둔다. 프록시의 idle 종료보다 짧아야 한다. */
const KEEPALIVE_MS = 25_000;

/** 재연결에서 한 번에 메워 주는 상한. 이보다 밀렸으면 화면이 목록을 다시 읽는 게 낫다. */
const CATCHUP_LIMIT = GROUP_MESSAGE_PAGE_SIZE * 2;

export const GET = route(async (request: Request) => {
  const viewer = await requireAdmin();
  // 브라우저가 자동 재연결에 실어 보내는 값. 처음 붙을 때는 쿼리로 줄 수 있다.
  const lastEventId =
    request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after");

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      function send(payload: string): void {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // 이미 닫힌 스트림. 정리는 abort 핸들러가 한다.
          closed = true;
        }
      }

      /**
       * 이벤트 하나. `id` 는 그 글의 작성 시각이라 재연결의 커서가 된다 —
       * 브라우저가 이 값을 기억했다가 `Last-Event-ID` 로 돌려준다.
       */
      function sendEvent(name: string, id: string | null, data: unknown): void {
        send(`${id ? `id: ${id}\n` : ""}event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
      }

      /**
       * 사건마다 DB 를 한 번 읽고 보낸다. 그 읽기가 비동기라 **그냥 띄우면 도착 순서가
       * 뒤집힌다** — 한 트랜잭션에서 여러 사건이 나올 때 실제로 어긋났다. 앞의 처리가
       * 끝난 뒤에 다음을 처리하도록 이어 붙인다.
       */
      let queue: Promise<void> = Promise.resolve();

      const unsubscribe = subscribeGroupChat((event) => {
        queue = queue
          .then(async () => {
            if (closed) return;
            // 볼 수 있는 글인지는 여기서 판정된다. 못 보면 null 이고 아무것도 나가지 않는다.
            const message = await withRls(rlsContextOf(viewer), (sql) =>
              readMessage(sql, event.messageId),
            );
            if (!message) return;
            sendEvent(event.kind === "deleted" ? "deleted" : "message", event.at, message);
          })
          .catch((error: unknown) => {
            // 한 건이 실패해도 연결은 유지한다. 다음 사건은 그대로 간다.
            console.error(
              "채팅 이벤트를 보내지 못했습니다:",
              error instanceof Error ? error.message : error,
            );
          });
      });

      const keepalive = setInterval(() => send(`: ping\n\n`), KEEPALIVE_MS);

      function cleanup(): void {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // 클라이언트가 먼저 끊은 경우. 닫을 것이 이미 없다.
        }
      }

      request.signal.addEventListener("abort", cleanup);

      // 연결을 곧바로 확정한다 — 첫 바이트가 나가야 브라우저가 open 으로 친다.
      send(`: connected\n\n`);

      // 끊겼던 동안의 것을 먼저 메운다. 구독을 먼저 걸어 두었으므로 그 사이에 들어온
      // 글도 잃지 않는다(같은 글이 두 번 가면 화면이 id 로 접는다).
      if (lastEventId) {
        void catchUp(viewer, lastEventId, sendEvent).catch((error: unknown) => {
          console.error(
            "놓친 채팅을 메우지 못했습니다:",
            error instanceof Error ? error.message : error,
          );
        });
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      // 중간 프록시가 모아 두면 실시간이 아니게 된다.
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
});

async function catchUp(
  viewer: Viewer,
  since: string,
  sendEvent: (name: string, id: string | null, data: unknown) => void,
): Promise<void> {
  const missed = await withRls(rlsContextOf(viewer), (sql) =>
    listMessagesSince(sql, since, CATCHUP_LIMIT),
  );
  for (const message of missed) {
    sendEvent(
      message.deleted ? "deleted" : "message",
      message.createdAt.toISOString(),
      message,
    );
  }
}
