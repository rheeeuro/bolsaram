/**
 * 텔레그램 Bot API 클라이언트 (설계 변경 문서 TELEGRAM v1 §5·§15).
 *
 * 이 파일만 api.telegram.org 를 안다. 상위 레이어는 도메인 형태만 다룬다.
 *
 * 보안 규칙:
 *   * 토큰은 URL 경로에 들어가므로 어떤 오류 메시지에도 URL 을 그대로 싣지 않는다.
 *   * getFile 이 돌려준 file_path 를 그대로 붙이지 않고 형태를 검사한다.
 *     `..` 이 섞이면 같은 호스트의 Bot API 경로로 되돌아갈 수 있다(토큰이 경로에 있다).
 *   * 내려받은 바이트는 크기와 MIME 을 다시 확인한다. 텔레그램이 알려준 값을 믿지 않는다.
 */
import "server-only";
import {
  TELEGRAM_MAX_FILE_BYTES,
  telegramFileResponseSchema,
  type TelegramFile,
} from "@bolsaram/schemas";
import { DomainError } from "@bolsaram/domain";
import { env } from "../env";
import { safeEqual } from "../crypto";
import { isAllowedImageType } from "../storage/local";

const API_ORIGIN = "https://api.telegram.org";
/** 봇 API 호출 타임아웃. webhook 응답이 늦으면 텔레그램이 재전송한다. */
const CALL_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;

function token(): string {
  const value = env().TELEGRAM_BOT_TOKEN;
  if (!value) {
    throw new DomainError("INVALID_STATE", "TELEGRAM_BOT_TOKEN 이 설정되지 않았습니다.");
  }
  return value;
}

/**
 * webhook 발신자 확인. 텔레그램이 setWebhook 의 secret_token 을
 * `X-Telegram-Bot-Api-Secret-Token` 헤더로 되돌려준다.
 * 헤더가 없거나 다르면 우리 봇으로 온 요청이 아니다.
 */
export function verifyWebhookSecret(headerValue: string | null): boolean {
  const expected = env().TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !headerValue) return false;
  return safeEqual(expected, headerValue);
}

async function callBotApi<T>(method: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/bot${token()}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (error) {
    // 토큰이 URL 에 있으므로 원본 오류를 그대로 올리지 않는다.
    throw new DomainError("INVALID_STATE", `텔레그램 ${method} 호출에 실패했습니다.`, {
      cause: error instanceof Error ? error.name : "unknown",
    });
  }
  if (!response.ok) {
    throw new DomainError(
      "INVALID_STATE",
      `텔레그램 ${method} 응답이 정상이 아닙니다 (${response.status}).`,
    );
  }
  return (await response.json()) as T;
}

/** 봇 이름. 연결 딥링크(`t.me/<봇>?start=…`)를 만들 때 쓴다. */
export async function getBotUsername(): Promise<string | null> {
  const payload = await callBotApi<{ ok?: boolean; result?: { username?: string } }>("getMe");
  return payload.result?.username ?? null;
}

/** 봇이 보내는 메시지. 프로필 원문·사진 URL 을 여기 싣지 않는다. */
export async function sendMessage(
  chatId: number,
  text: string,
  options: { buttonText?: string; buttonUrl?: string } = {},
): Promise<void> {
  const reply_markup =
    options.buttonText && options.buttonUrl
      ? { inline_keyboard: [[{ text: options.buttonText, url: options.buttonUrl }]] }
      : undefined;
  await callBotApi("sendMessage", {
    chat_id: chatId,
    text,
    ...(reply_markup ? { reply_markup } : {}),
  });
}

export async function getFile(fileId: string): Promise<TelegramFile> {
  const payload = await callBotApi<unknown>("getFile", { file_id: fileId });
  const parsed = telegramFileResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new DomainError("INVALID_STATE", "텔레그램 파일 정보를 읽을 수 없습니다.");
  }
  return parsed.data.result;
}

/** file_path 는 텔레그램이 준 값이지만 경로로 쓰이므로 형태를 검사한다. */
function assertSafeFilePath(filePath: string): void {
  if (filePath.includes("..") || !/^[A-Za-z0-9_\-./]+$/.test(filePath) || filePath.startsWith("/")) {
    throw new DomainError("VALIDATION", "허용되지 않은 텔레그램 파일 경로입니다.");
  }
}

export type DownloadedFile = { data: Buffer; mimeType: string; byteSize: number };

/**
 * 파일을 받아 메모리로 읽는다. 즉시 private 스토리지로 복사할 목적이며
 * 텔레그램의 임시 URL 을 어디에도 저장하지 않는다(§15).
 *
 * `declaredMimeType` 은 메시지에서 판정한 값이다. 응답 헤더가 다른 값을 주면
 * 둘 중 허용 목록에 있는 쪽을 쓰고, 둘 다 아니면 거부한다.
 */
export async function downloadFile(
  filePath: string,
  declaredMimeType: string,
): Promise<DownloadedFile> {
  assertSafeFilePath(filePath);

  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/file/bot${token()}/${filePath}`, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    throw new DomainError("INVALID_STATE", "텔레그램에서 사진을 받지 못했습니다.", {
      cause: error instanceof Error ? error.name : "unknown",
    });
  }
  if (!response.ok) {
    throw new DomainError(
      "INVALID_STATE",
      `텔레그램에서 사진을 받지 못했습니다 (${response.status}).`,
    );
  }

  // 헤더를 먼저 보고 큰 파일은 본문을 읽기 전에 끊는다.
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > TELEGRAM_MAX_FILE_BYTES) {
    throw new DomainError("VALIDATION", "사진이 너무 큽니다.", { byteSize: declaredLength });
  }

  const data = Buffer.from(await response.arrayBuffer());
  // 헤더가 거짓말을 했을 수 있으므로 실제 크기로 다시 판정한다.
  if (data.byteLength === 0) {
    throw new DomainError("VALIDATION", "빈 파일입니다.");
  }
  if (data.byteLength > TELEGRAM_MAX_FILE_BYTES) {
    throw new DomainError("VALIDATION", "사진이 너무 큽니다.", { byteSize: data.byteLength });
  }

  const headerMime = (response.headers.get("content-type") ?? "").split(";")[0]!.trim();
  const mimeType = isAllowedImageType(declaredMimeType)
    ? declaredMimeType
    : isAllowedImageType(headerMime)
      ? headerMime
      : null;
  if (!mimeType) {
    throw new DomainError("VALIDATION", "지원하지 않는 이미지 형식입니다.");
  }

  return { data, mimeType, byteSize: data.byteLength };
}
