/**
 * 텔레그램 봇 대화 로직 (설계 변경 문서 TELEGRAM v1 §5·§6·§11).
 *
 *   WAITING_MEDIA → WAITING_TEXT → READY → (분석은 Import 상태 기계가 이어받는다)
 *                        └──────── CANCELED / EXPIRED ────────┘
 *
 * 이 파일은 순수 함수만 둔다. 네트워크·DB·Bot API 타입을 모른다.
 * "어떤 메시지를 무엇으로 해석하는가"의 단일 판정 지점이며, webhook 라우트는
 * 여기서 나온 결론만 실행한다.
 */
import {
  TELEGRAM_MAX_ASSETS_PER_SESSION,
  type TelegramMessage,
  type TelegramSessionState,
} from "@bolsaram/schemas";
import { DomainError } from "./errors";

/** 대화가 방치되면 만료시키는 기준. 실제 값은 운영하면서 조정한다. */
export const TELEGRAM_SESSION_TTL_HOURS = 24;

/** 봇이 이해하는 명령. 자유문장은 해석하지 않는다(§11). */
export const TELEGRAM_COMMANDS = [
  "/start",
  "/new",
  "/cancel",
  "/status",
  "/analyze",
  /** 담을 모임 확인·변경. 인자 없으면 목록, `/room 2` 면 2번으로 옮긴다. */
  "/room",
  "/help",
] as const;
export type TelegramCommand = (typeof TELEGRAM_COMMANDS)[number];

const ALLOWED_TELEGRAM_TRANSITIONS: Record<
  TelegramSessionState,
  readonly TelegramSessionState[]
> = {
  // 사진을 기다리는 중에도 글이 먼저 올 수 있다.
  WAITING_MEDIA: ["WAITING_TEXT", "READY", "CANCELED", "EXPIRED"],
  // 글을 기다리는 중에 사진을 더 보낼 수 있다.
  WAITING_TEXT: ["WAITING_MEDIA", "READY", "CANCELED", "EXPIRED"],
  // 분석 대기 상태에서도 사진·글을 덧붙일 수 있다.
  READY: ["WAITING_MEDIA", "WAITING_TEXT", "CANCELED", "EXPIRED"],
  // 종착점. 다시 등록하려면 새 대화를 시작한다(/new).
  CANCELED: [],
  EXPIRED: [],
};

/** 대화가 아직 입력을 받을 수 있는 상태인지. */
export function isTelegramSessionOpen(state: TelegramSessionState): boolean {
  return state === "WAITING_MEDIA" || state === "WAITING_TEXT" || state === "READY";
}

export function assertTelegramTransition(
  from: TelegramSessionState,
  to: TelegramSessionState,
): void {
  if (from === to) return;
  const allowed = ALLOWED_TELEGRAM_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new DomainError(
      "INVALID_STATE",
      `봇 대화 상태를 ${from} → ${to} 로 바꿀 수 없습니다.`,
      { from, to, allowed },
    );
  }
}

/**
 * 세션에 들어온 것만 보고 대화 상태를 정한다.
 *
 * 글이 있으면 분석할 수 있으므로 READY 다 — 사진이 없어도 된다(텍스트만 Import).
 * 종료된 대화는 무엇이 들어와도 그대로 둔다.
 */
export function nextTelegramState(input: {
  current: TelegramSessionState;
  assetCount: number;
  hasText: boolean;
}): TelegramSessionState {
  if (!isTelegramSessionOpen(input.current)) return input.current;
  if (input.hasText) return "READY";
  if (input.assetCount > 0) return "WAITING_TEXT";
  return "WAITING_MEDIA";
}

export function isTelegramSessionStale(
  lastActivityAt: Date,
  now: Date = new Date(),
): boolean {
  const age = now.getTime() - lastActivityAt.getTime();
  return age > TELEGRAM_SESSION_TTL_HOURS * 3_600_000;
}

// ── 메시지 분류 ───────────────────────────────────────────────

/** 봇이 실행할 수 있는 형태로 바꾼 수신 메시지. */
export type TelegramIntent =
  | { kind: "command"; command: TelegramCommand; argument: string | null }
  | {
      kind: "photo";
      fileId: string;
      fileUniqueId: string;
      /** 텔레그램이 알려준 크기. 없으면 내려받은 뒤에 확인한다. */
      declaredSize: number | null;
      mimeType: string;
      filename: string | null;
      mediaGroupId: string | null;
      /** 사진에 붙은 설명. 글이 아직 없을 때만 원문 후보로 쓴다(§5.4). */
      caption: string | null;
    }
  | { kind: "text"; text: string }
  | { kind: "ignored"; reason: string };

/**
 * `/start abc123` 같은 명령을 뽑는다.
 * 그룹에서는 `/start@BolsaramBot` 형태로 오므로 봇 이름을 떼어낸다.
 */
function parseCommand(text: string): TelegramIntent | null {
  if (!text.startsWith("/")) return null;
  const [head, ...rest] = text.trim().split(/\s+/);
  const name = head!.split("@")[0]!.toLowerCase();
  if (!(TELEGRAM_COMMANDS as readonly string[]).includes(name)) {
    return { kind: "ignored", reason: `알 수 없는 명령입니다: ${name}` };
  }
  const argument = rest.join(" ").trim();
  return {
    kind: "command",
    command: name as TelegramCommand,
    argument: argument.length > 0 ? argument : null,
  };
}

/**
 * 사진으로 보낸 것과 파일로 보낸 것을 같은 형태로 만든다.
 *
 * `photo` 는 해상도별 변형 목록이고 마지막 원소가 가장 크다. 텔레그램이 JPEG 로
 * 다시 인코딩하므로 mime 은 image/jpeg 로 고정된다. 원본 화질이 필요하면
 * 운영자가 "파일로 보내기"를 쓰고, 그 경우 document 의 mime 을 그대로 쓴다.
 */
export function classifyTelegramMessage(message: TelegramMessage): TelegramIntent {
  const caption = normalizeOptional(message.caption);

  if (message.photo && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1]!;
    return {
      kind: "photo",
      fileId: largest.file_id,
      fileUniqueId: largest.file_unique_id,
      declaredSize: largest.file_size ?? null,
      mimeType: "image/jpeg",
      filename: null,
      mediaGroupId: message.media_group_id ?? null,
      caption,
    };
  }

  if (message.document) {
    const mime = message.document.mime_type?.toLowerCase() ?? "";
    if (!mime.startsWith("image/")) {
      return { kind: "ignored", reason: "이미지가 아닌 파일은 받지 않습니다." };
    }
    return {
      kind: "photo",
      fileId: message.document.file_id,
      fileUniqueId: message.document.file_unique_id,
      declaredSize: message.document.file_size ?? null,
      mimeType: mime,
      filename: message.document.file_name ?? null,
      mediaGroupId: message.media_group_id ?? null,
      caption,
    };
  }

  const text = normalizeOptional(message.text);
  if (text) {
    return parseCommand(text) ?? { kind: "text", text };
  }

  return { kind: "ignored", reason: "처리할 내용이 없는 메시지입니다." };
}

function normalizeOptional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

// ── 원문 누적 ─────────────────────────────────────────────────

/** rawText 상한. `updateImportTextSchema` 와 같은 값을 쓴다. */
export const TELEGRAM_RAW_TEXT_LIMIT = 20_000;

/**
 * 들어온 글을 기존 원문에 어떻게 합칠지 정한다(§5.3·§5.4).
 *
 * - 운영자가 직접 보낸 글은 누적한다. 카카오톡에서 복사한 프로필이 여러 메시지로
 *   쪼개져 오는 일이 흔하다. 처음부터 다시 쓰려면 `/new` 로 새 대화를 시작한다.
 * - 사진 설명(caption)은 원문이 **아직 없을 때만** 채운다. 직접 보낸 글이 항상 이긴다.
 * - 상한을 넘으면 잘라내고 잘렸다는 사실을 알려준다 — 조용히 버리지 않는다.
 */
export function mergeRawText(
  current: string | null,
  incoming: { source: "text" | "caption"; value: string },
): { rawText: string; truncated: boolean; changed: boolean } {
  const existing = current?.trim() ?? "";
  const value = incoming.value.trim();

  if (value.length === 0) {
    return { rawText: existing, truncated: false, changed: false };
  }
  if (incoming.source === "caption" && existing.length > 0) {
    return { rawText: existing, truncated: false, changed: false };
  }

  const merged = existing.length > 0 ? `${existing}\n\n${value}` : value;
  const truncated = merged.length > TELEGRAM_RAW_TEXT_LIMIT;
  return {
    rawText: truncated ? merged.slice(0, TELEGRAM_RAW_TEXT_LIMIT) : merged,
    truncated,
    changed: true,
  };
}

// ── 앨범 ──────────────────────────────────────────────────────

/**
 * 사진 안내를 보낼지 — **첫 장에만** 보낸다.
 *
 * 처음에는 `media_group_id` 가 같으면 억제하는 방식이었는데, 실제 운영 경로에서
 * 그 값이 오지 않는다. 카카오톡 「공유하기」로 여러 장을 한 번에 텔레그램으로 보내면
 * 텔레그램은 **앨범이 아니라 개별 메시지로** 하나씩 전달한다(실측 2026-09-07:
 * 4장 전부 media_group_id 없음). 그래서 장수만큼 안내가 나가 시끄러웠다.
 *
 * 앨범 식별자에 기대지 않는다. 첫 장에서 "다음에 무엇을 할지"만 알려주고, 총 장수는
 * 글을 받을 때 정확한 값으로 한 번 알려준다. 중간 확인은 `/status` 로 한다.
 *
 * 사진을 하나로 묶는 일은 대화 세션이 하므로 버퍼링·debounce 는 여전히 필요 없다.
 */
export function shouldAnnounceMedia(uploadedBefore: number): boolean {
  return uploadedBefore === 0;
}

/** 세션이 사진을 더 받을 수 있는지. 넘치면 봇이 알려주고 받지 않는다. */
export function assertAssetCapacity(currentCount: number): void {
  if (currentCount >= TELEGRAM_MAX_ASSETS_PER_SESSION) {
    throw new DomainError(
      "VALIDATION",
      `사진은 한 번에 ${TELEGRAM_MAX_ASSETS_PER_SESSION}장까지 받습니다.`,
      { limit: TELEGRAM_MAX_ASSETS_PER_SESSION },
    );
  }
}

/**
 * `/room` 의 인자를 해석한다.
 *
 * 봇은 URL 버튼만 보낼 수 있고 눌러서 고르는 버튼(callback)은 다루지 않는다.
 * 그래서 방을 **번호로** 고른다 — 목록을 1번부터 붙여 보여주고 `/room 2` 로 옮긴다.
 * 1번은 항상 전체공개다(소속 없는 방도 하나의 방으로 센다).
 *
 * 숫자가 아니거나 범위를 벗어나면 고르지 않는다 — 조용히 엉뚱한 방으로 옮기는 것보다
 * 목록을 다시 보여주는 편이 낫다.
 */
export function parseRoomChoice(
  argument: string | null,
  roomCount: number,
): { kind: "list" } | { kind: "pick"; index: number } | { kind: "outOfRange" } {
  if (argument == null) return { kind: "list" };
  if (!/^[0-9]{1,3}$/.test(argument.trim())) return { kind: "outOfRange" };
  const picked = Number(argument.trim());
  if (picked < 1 || picked > roomCount) return { kind: "outOfRange" };
  // 화면에는 1번부터 보여주고 배열은 0부터 센다.
  return { kind: "pick", index: picked - 1 };
}
