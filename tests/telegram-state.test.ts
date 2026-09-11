/**
 * 텔레그램 봇 대화 로직 단위 테스트
 * (설계 변경 문서 TELEGRAM v1 §5·§6·§11, §18 「Webhook」).
 *
 * 여기서 지키는 성질:
 *   * 사진 여러 장을 어떻게 보내도 하나의 대화로 묶인다(앨범·연속 전송).
 *   * 직접 보낸 글이 사진 설명(caption)보다 항상 우선한다.
 *   * 이미지가 아닌 것은 받지 않는다.
 *   * 끝난 대화는 되살아나지 않는다.
 */
import { describe, expect, it } from "vitest";
import {
  TELEGRAM_RAW_TEXT_LIMIT,
  TELEGRAM_SESSION_TTL_HOURS,
  assertAssetCapacity,
  assertTelegramTransition,
  classifyTelegramMessage,
  isTelegramSessionOpen,
  isTelegramSessionStale,
  mergeRawText,
  parseRoomChoice,
  nextTelegramState,
  shouldAnnounceMedia,
} from "@bolsaram/domain";
import {
  TELEGRAM_MAX_ASSETS_PER_SESSION,
  telegramUpdateSchema,
  type TelegramMessage,
} from "@bolsaram/schemas";

function message(overrides: Partial<TelegramMessage> = {}): TelegramMessage {
  return {
    message_id: 1,
    chat: { id: 500, type: "private" },
    date: 1_700_000_000,
    from: { id: 500, is_bot: false },
    ...overrides,
  };
}

const photoSizes = [
  { file_id: "small", file_unique_id: "u-small", width: 90, height: 120 },
  { file_id: "large", file_unique_id: "u-large", width: 900, height: 1200, file_size: 240_000 },
];

describe("메시지 분류", () => {
  it("사진은 가장 큰 해상도를 고른다", () => {
    const intent = classifyTelegramMessage(message({ photo: photoSizes }));
    expect(intent).toMatchObject({
      kind: "photo",
      fileId: "large",
      mimeType: "image/jpeg",
      declaredSize: 240_000,
    });
  });

  it("앨범은 media_group_id 를 함께 넘긴다", () => {
    const intent = classifyTelegramMessage(
      message({ photo: photoSizes, media_group_id: "group-1" }),
    );
    expect(intent).toMatchObject({ kind: "photo", mediaGroupId: "group-1" });
  });

  it("사진 설명은 caption 으로 넘어온다", () => {
    const intent = classifyTelegramMessage(
      message({ photo: photoSizes, caption: "  93년생 마케터  " }),
    );
    expect(intent).toMatchObject({ kind: "photo", caption: "93년생 마케터" });
  });

  it("파일로 보낸 이미지는 원본 mime 을 쓴다", () => {
    const intent = classifyTelegramMessage(
      message({
        document: {
          file_id: "doc",
          file_unique_id: "u-doc",
          mime_type: "image/png",
          file_name: "profile.png",
        },
      }),
    );
    expect(intent).toMatchObject({
      kind: "photo",
      mimeType: "image/png",
      filename: "profile.png",
    });
  });

  it("이미지가 아닌 파일은 받지 않는다", () => {
    const intent = classifyTelegramMessage(
      message({
        document: {
          file_id: "doc",
          file_unique_id: "u-doc",
          mime_type: "application/pdf",
          file_name: "profile.pdf",
        },
      }),
    );
    expect(intent.kind).toBe("ignored");
  });

  it("mime 이 없는 파일도 받지 않는다", () => {
    const intent = classifyTelegramMessage(
      message({ document: { file_id: "doc", file_unique_id: "u-doc" } }),
    );
    expect(intent.kind).toBe("ignored");
  });

  it("일반 글은 text 다", () => {
    expect(classifyTelegramMessage(message({ text: "87년생\n계리사" }))).toEqual({
      kind: "text",
      text: "87년생\n계리사",
    });
  });

  it("명령과 인자를 분리한다", () => {
    expect(classifyTelegramMessage(message({ text: "/start abc123" }))).toEqual({
      kind: "command",
      command: "/start",
      argument: "abc123",
    });
  });

  it("그룹에서 붙는 봇 이름을 떼어낸다", () => {
    expect(classifyTelegramMessage(message({ text: "/new@BolsaramBot" }))).toEqual({
      kind: "command",
      command: "/new",
      argument: null,
    });
  });

  it("모르는 명령은 실행하지 않는다", () => {
    // 자유문장을 명령으로 해석하지 않는다(§11).
    expect(classifyTelegramMessage(message({ text: "/등록해줘" })).kind).toBe("ignored");
  });

  it("빈 메시지는 무시한다", () => {
    expect(classifyTelegramMessage(message({ text: "   " })).kind).toBe("ignored");
    expect(classifyTelegramMessage(message()).kind).toBe("ignored");
  });
});

describe("webhook payload 검증", () => {
  it("update_id 가 없으면 거부한다", () => {
    expect(telegramUpdateSchema.safeParse({ message: message() }).success).toBe(false);
  });

  it("모르는 필드는 조용히 버린다", () => {
    // 텔레그램이 필드를 추가해도 깨지지 않아야 한다.
    const parsed = telegramUpdateSchema.safeParse({
      update_id: 7,
      message: { ...message({ text: "안녕" }), business_connection_id: "x" },
      some_future_update: { anything: true },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.message?.text).toBe("안녕");
  });

  it("우리가 쓰지 않는 update 는 message 없이 통과한다", () => {
    const parsed = telegramUpdateSchema.safeParse({
      update_id: 8,
      callback_query: { id: "cb" },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.message).toBeUndefined();
  });
});

describe("원문 합치기", () => {
  it("직접 보낸 글은 누적한다", () => {
    // 카카오톡 프로필이 여러 메시지로 쪼개져 오는 일이 흔하다.
    const first = mergeRawText(null, { source: "text", value: "87년생" });
    const second = mergeRawText(first.rawText, { source: "text", value: "계리사" });
    expect(second.rawText).toBe("87년생\n\n계리사");
    expect(second.changed).toBe(true);
  });

  it("사진 설명은 글이 없을 때만 채운다", () => {
    expect(mergeRawText(null, { source: "caption", value: "87년생" }).rawText).toBe("87년생");
  });

  it("직접 보낸 글이 사진 설명보다 우선한다", () => {
    // §5.4 의 우선순위. 이미 글이 있으면 caption 은 버린다.
    const merged = mergeRawText("직접 보낸 글", { source: "caption", value: "사진 설명" });
    expect(merged.rawText).toBe("직접 보낸 글");
    expect(merged.changed).toBe(false);
  });

  it("빈 글은 아무것도 바꾸지 않는다", () => {
    expect(mergeRawText("원문", { source: "text", value: "   " })).toEqual({
      rawText: "원문",
      truncated: false,
      changed: false,
    });
  });

  it("상한을 넘으면 잘라내고 잘렸다고 알린다", () => {
    const merged = mergeRawText(null, {
      source: "text",
      value: "가".repeat(TELEGRAM_RAW_TEXT_LIMIT + 100),
    });
    expect(merged.rawText.length).toBe(TELEGRAM_RAW_TEXT_LIMIT);
    expect(merged.truncated).toBe(true);
  });
});

describe("대화 상태", () => {
  it("아무것도 없으면 사진을 기다린다", () => {
    expect(nextTelegramState({ current: "WAITING_MEDIA", assetCount: 0, hasText: false })).toBe(
      "WAITING_MEDIA",
    );
  });

  it("사진만 있으면 글을 기다린다", () => {
    expect(nextTelegramState({ current: "WAITING_MEDIA", assetCount: 3, hasText: false })).toBe(
      "WAITING_TEXT",
    );
  });

  it("글이 있으면 분석할 수 있다", () => {
    // 사진이 없어도 텍스트만으로 Import 할 수 있다.
    expect(nextTelegramState({ current: "WAITING_MEDIA", assetCount: 0, hasText: true })).toBe(
      "READY",
    );
  });

  it("끝난 대화는 무엇이 들어와도 되살아나지 않는다", () => {
    for (const current of ["CANCELED", "EXPIRED"] as const) {
      expect(nextTelegramState({ current, assetCount: 5, hasText: true })).toBe(current);
    }
  });

  it("열린 상태만 입력을 받는다", () => {
    expect(["WAITING_MEDIA", "WAITING_TEXT", "READY"].every(isTelegramSessionOpen)).toBe(true);
    expect(isTelegramSessionOpen("CANCELED")).toBe(false);
    expect(isTelegramSessionOpen("EXPIRED")).toBe(false);
  });

  it("글을 기다리는 중에도 사진을 더 받는다", () => {
    expect(() => assertTelegramTransition("WAITING_TEXT", "WAITING_MEDIA")).not.toThrow();
    expect(() => assertTelegramTransition("READY", "WAITING_TEXT")).not.toThrow();
  });

  it("취소된 대화는 어떤 상태로도 되돌리지 못한다", () => {
    expect(() => assertTelegramTransition("CANCELED", "WAITING_MEDIA")).toThrow(/바꿀 수 없/);
    expect(() => assertTelegramTransition("EXPIRED", "READY")).toThrow(/바꿀 수 없/);
  });

  it("같은 상태로의 전이는 통과한다", () => {
    expect(() => assertTelegramTransition("CANCELED", "CANCELED")).not.toThrow();
  });
});

describe("사진 안내", () => {
  it("첫 장에만 안내한다", () => {
    expect(shouldAnnounceMedia(0)).toBe(true);
    expect(shouldAnnounceMedia(1)).toBe(false);
    expect(shouldAnnounceMedia(3)).toBe(false);
  });

  it("여러 장을 한 번에 보내도 안내는 한 번뿐이다", () => {
    // 실측(2026-09-07): 카카오톡 「공유하기」로 4장을 한 번에 보내면 텔레그램은
    // media_group_id 없이 개별 메시지 4건으로 전달한다. 앨범 식별자로는 억제할 수
    // 없으므로 "이미 받은 장수"로 판정한다. 4장이면 안내는 1건이어야 한다.
    const announcements = [0, 1, 2, 3].filter(shouldAnnounceMedia);
    expect(announcements).toHaveLength(1);
  });
});

describe("한도와 만료", () => {
  it("사진 상한을 넘으면 받지 않는다", () => {
    expect(() => assertAssetCapacity(TELEGRAM_MAX_ASSETS_PER_SESSION - 1)).not.toThrow();
    expect(() => assertAssetCapacity(TELEGRAM_MAX_ASSETS_PER_SESSION)).toThrow(/장까지/);
  });

  it("방치된 대화를 만료로 판정한다", () => {
    const now = new Date("2026-09-07T12:00:00Z");
    const justInside = new Date(now.getTime() - (TELEGRAM_SESSION_TTL_HOURS - 1) * 3_600_000);
    const outside = new Date(now.getTime() - (TELEGRAM_SESSION_TTL_HOURS + 1) * 3_600_000);
    expect(isTelegramSessionStale(justInside, now)).toBe(false);
    expect(isTelegramSessionStale(outside, now)).toBe(true);
  });
});

describe("parseRoomChoice", () => {
  it("인자가 없으면 목록을 보여준다", () => {
    expect(parseRoomChoice(null, 3)).toEqual({ kind: "list" });
  });

  it("번호는 1부터 세고 배열 자리로 바꾼다", () => {
    expect(parseRoomChoice("1", 3)).toEqual({ kind: "pick", index: 0 });
    expect(parseRoomChoice("3", 3)).toEqual({ kind: "pick", index: 2 });
  });

  it("앞뒤 공백은 무시한다", () => {
    expect(parseRoomChoice(" 2 ", 3)).toEqual({ kind: "pick", index: 1 });
  });

  it("범위를 벗어나면 고르지 않는다", () => {
    expect(parseRoomChoice("0", 3)).toEqual({ kind: "outOfRange" });
    expect(parseRoomChoice("4", 3)).toEqual({ kind: "outOfRange" });
  });

  it("숫자가 아니면 고르지 않는다", () => {
    // 방 이름을 그대로 적는 경우가 있다. 이름으로는 고르지 않는다 — 같은 이름이
    // 여러 개일 수 있고, 오타를 조용히 다른 방으로 해석하면 안 된다.
    expect(parseRoomChoice("강남", 3)).toEqual({ kind: "outOfRange" });
    expect(parseRoomChoice("2번", 3)).toEqual({ kind: "outOfRange" });
    expect(parseRoomChoice("", 3)).toEqual({ kind: "outOfRange" });
  });
});
