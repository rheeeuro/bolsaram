/**
 * 모임 채팅방 (마이그레이션 0040).
 *
 * 주선자 전용 운영 채널이다. 회원은 들어오지 않으므로 여기 스키마에는
 * 프로필·연락처가 등장하지 않는다 — 본문 텍스트 하나뿐이다.
 */
import { z } from "zod";

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
 *   after    그 시각보다 이후 — 열어 둔 화면의 폴링
 *
 * 커서를 id 가 아니라 시각으로 두는 이유는 폴링이 「마지막으로 본 시각 이후」를
 * 그대로 묻기 때문이다.
 */
export const groupMessageQuerySchema = z
  .object({
    before: z.iso.datetime().optional(),
    after: z.iso.datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(GROUP_MESSAGE_PAGE_SIZE),
  })
  .refine((v) => !(v.before && v.after), {
    message: "before 와 after 는 함께 쓸 수 없습니다.",
  });
export type GroupMessageQuery = z.infer<typeof groupMessageQuerySchema>;

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
