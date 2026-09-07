/**
 * POST /api/integrations/telegram/webhook — 텔레그램 Bot API webhook
 * (설계 변경 문서 TELEGRAM v1 §10).
 *
 * 다른 라우트와 성격이 다르다.
 *   * 세션 쿠키가 없다. 발신자 확인은 setWebhook 의 secret_token 으로만 한다.
 *   * `route()` 래퍼를 쓰지 않는다. 텔레그램은 200 이 아닌 응답을 받으면 같은
 *     update 를 계속 재전송하므로, 처리 실패도 200 으로 답하고 서버 로그에 남긴다.
 *     (형식 오류·중복·권한 없는 발신자는 어댑터가 조용히 흘린다.)
 *   * 본문에 개인정보가 들어 있으므로 payload 를 로그에 남기지 않는다(§15).
 *
 * 채널이 꺼져 있으면 존재하지 않는 것처럼 404 를 준다 — 토큰 없이 열려 있는
 * webhook 은 검증도 답장도 못 하는 구멍이다.
 */
import { isTelegramEnabled } from "@/server/env";
import { handleTelegramUpdate } from "@/server/telegram/adapter";
import { verifyWebhookSecret } from "@/server/telegram/client";

export const dynamic = "force-dynamic";
/**
 * 사진 한 장을 받아 스토리지로 복사하는 데까지 기다린다. 응답을 먼저 주고
 * 뒤에서 처리하면 처리 실패를 재전송으로 만회할 수 없다.
 * AI 분석은 어댑터가 따로 띄우므로 이 시간에 포함되지 않는다.
 */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  if (!isTelegramEnabled()) {
    return new Response(null, { status: 404 });
  }
  // 헤더가 없거나 다르면 우리 봇으로 온 요청이 아니다. 본문을 읽지도 않는다.
  if (!verifyWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return new Response(null, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    // 본문이 JSON 이 아니면 재전송해도 소용없다. 200 으로 끊는다.
    console.warn("텔레그램 webhook 본문을 읽을 수 없습니다.");
    return new Response(null, { status: 200 });
  }

  await handleTelegramUpdate(payload);
  return new Response(null, { status: 200 });
}
