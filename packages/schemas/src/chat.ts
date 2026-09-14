/**
 * 모임 채팅방 (마이그레이션 0040).
 *
 * 주선자 전용 운영 채널이다. 회원은 들어오지 않으므로 여기 스키마에는
 * 프로필·연락처가 등장하지 않는다 — 본문 텍스트 하나뿐이다.
 */
import { z } from "zod";
import { GROUP_MESSAGE_SYSTEM_KINDS } from "./enums";

/** DB CHECK(`group_messages_body_sane`)와 같은 값. 한쪽만 바꾸면 저장에서 터진다. */
export const GROUP_MESSAGE_MAX_LENGTH = 2000;

/** 한 번에 읽어오는 개수. 방을 열 때와 「이전 대화」 모두 이 크기다. */
export const GROUP_MESSAGE_PAGE_SIZE = 50;

export const groupMessageCreateSchema = z.object({
  body: z.string().trim().min(1).max(GROUP_MESSAGE_MAX_LENGTH),
});
export type GroupMessageCreate = z.infer<typeof groupMessageCreateSchema>;

/**
 * 목록 조회.
 *
 *   (없음)   최근 한 페이지
 *   before   그 시각보다 이전 — 위로 거슬러 올라간다
 *
 * 앞으로 오는 것은 묻지 않는다. 새 글은 스트림이 밀어준다(0043).
 * 커서가 id 가 아니라 시각인 것은 화면이 시각으로 정렬하기 때문이다.
 */
export const groupMessageQuerySchema = z.object({
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(GROUP_MESSAGE_PAGE_SIZE),
});
export type GroupMessageQuery = z.infer<typeof groupMessageQuerySchema>;

/**
 * 시스템 메시지가 싣는 것 (마이그레이션 0044).
 *
 * 전부 선택이다 — 종류마다 채우는 것이 다르다. 회원은 공개 번호로만 등장하고
 * 이름이 들어가는 자리는 **주선자 이름 하나뿐**이다(`actorName`).
 * 나간 주선자는 나중에 `users` 에서 읽을 수 없어서 그때 값을 적어 둔다.
 */
export const groupMessagePayloadSchema = z.object({
  actorName: z.string().nullish(),
  profileCode: z.number().int().nullish(),
  requesterCode: z.number().int().nullish(),
  targetCode: z.number().int().nullish(),
});
export type GroupMessagePayload = z.infer<typeof groupMessagePayloadSchema>;

export const groupMessageSystemKindSchema = z.enum(GROUP_MESSAGE_SYSTEM_KINDS);

/**
 * DB 가 `pg_notify` 로 알리는 채팅 변화 (마이그레이션 0043).
 *
 * 이 채널은 **권한 판정을 거치지 않는다** — 듣는 커넥션 하나가 모든 방의 사건을
 * 받는다. 그래서 본문이 실리지 않고 「어느 방에서 무엇이 바뀌었다」만 온다.
 * 받는 쪽이 자기 컨텍스트로 다시 읽어야 내용을 알 수 있다.
 *
 * DB 가 만든 값이지만 밖에서 들어오는 payload 와 같은 규칙으로 검증한다.
 */
export const groupChatNotifySchema = z.object({
  kind: z.enum(["created", "deleted"]),
  groupId: z.uuid(),
  messageId: z.uuid(),
  /** 놓친 구간을 되짚는 커서. 저장 정밀도와 같은 밀리초다(0042). */
  at: z.iso.datetime(),
});
export type GroupChatNotify = z.infer<typeof groupChatNotifySchema>;

/**
 * 내 방 상태. 보낸 필드만 바꾼다.
 *
 *   readUpTo        여기까지 읽었다(배지에서 뺀다)
 *   telegramNotify  이 방의 새 글을 텔레그램으로도 받는다
 */
export const groupChatPrefsSchema = z
  .object({
    readUpTo: z.iso.datetime().optional(),
    telegramNotify: z.boolean().optional(),
  })
  .refine((v) => v.readUpTo !== undefined || v.telegramNotify !== undefined, {
    message: "바꿀 항목이 없습니다.",
  });
export type GroupChatPrefs = z.infer<typeof groupChatPrefsSchema>;
