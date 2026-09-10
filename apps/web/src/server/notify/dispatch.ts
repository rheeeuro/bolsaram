/**
 * 알림 발송 (마이그레이션 0017).
 *
 * 아웃박스에 쌓인 알림을 집어 텔레그램으로 보낸다. 요청 경로에서는 결과를 기다리지
 * 않고 `scheduleDispatch()` 로 띄우기만 한다 — 텔레그램이 느리다고 「마음 보내기」가
 * 느려지면 안 된다. 그래도 놓치지 않는 이유는 보낼 것이 DB 에 남아 있기 때문이다.
 * 프로세스가 죽어 한 번을 놓쳐도 기동 후 주기 스윕이 밀린 것을 보낸다.
 *
 * 실패는 삼키지 않되 **요청을 깨뜨리지도 않는다** — 알림은 부가 기능이고, 신청 자체는
 * 이미 커밋됐다. 원인은 `notifications.last_error` 에 남고 시도 횟수가 상한에 닿으면
 * 멈춘다.
 */
import "server-only";
import { env } from "../env";
import { sendMessage } from "../telegram/client";
import { messages } from "../telegram/messages";
import { claimPending, markFailed, markSent, type ClaimedNotification } from "./outbox";

/** 주기 스윕 간격. 요청 경로가 즉시 띄우므로 이건 놓친 것을 줍는 그물이다. */
const SWEEP_INTERVAL_MS = 5 * 60_000;

function textFor(item: ClaimedNotification): string {
  switch (item.kind) {
    case "MATCH_REQUESTED":
      return messages.matchRequested(item.requesterCode, item.targetCode);
    case "MATCH_ACCEPTED":
      return messages.matchAccepted(item.requesterCode, item.targetCode);
    case "MEMBER_INTENT":
      return messages.memberIntent(item.intentKind, item.requesterCode, item.targetCode);
  }
}

/**
 * 밀린 알림을 모두 보낸다. 한 건이 실패해도 나머지는 계속 보낸다.
 * 반환값은 로그·테스트용이며 호출부가 반드시 쓸 필요는 없다.
 */
export async function dispatchPending(): Promise<{ sent: number; failed: number }> {
  if (!env().TELEGRAM_ENABLED) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const items = await claimPending();
  const requestsUrl = `${env().APP_ORIGIN}/requests`;

  for (const item of items) {
    try {
      await sendMessage(item.chatId, textFor(item), {
        buttonText: messages.requestsButton,
        buttonUrl: requestsUrl,
      });
      await markSent(item.id);
      sent += 1;
    } catch (error) {
      failed += 1;
      // 봇 API 오류 메시지에는 토큰이 없다(client.ts 가 URL 을 싣지 않는다).
      const reason = error instanceof Error ? error.message : "알 수 없는 오류";
      await markFailed(item.id, reason);
      console.error(`알림 발송 실패 (${item.id}): ${reason}`);
    }
  }
  return { sent, failed };
}

/**
 * 응답을 막지 않고 발송을 띄운다. 요청 경로에서 쓴다.
 * 실패해도 요청은 이미 성공한 뒤이므로 로그만 남긴다.
 */
export function scheduleDispatch(): void {
  void dispatchPending().catch((error: unknown) => {
    console.error("알림 발송 중 예외:", error instanceof Error ? error.message : error);
  });
}

/**
 * 기동 시 한 번, 이후 주기적으로 스윕한다. `startup-node.ts` 가 부른다.
 * 텔레그램이 꺼져 있으면 타이머를 걸지 않는다.
 */
export function startNotificationSweep(): void {
  if (!env().TELEGRAM_ENABLED) return;
  scheduleDispatch();
  // 프로세스 종료를 막지 않도록 unref 한다.
  setInterval(scheduleDispatch, SWEEP_INTERVAL_MS).unref();
}
