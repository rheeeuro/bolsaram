/**
 * 텔레그램 Bot API 와 주고받는 payload 스키마 (설계 변경 문서 TELEGRAM v1 §5·§9).
 *
 * webhook 본문은 **외부에서 들어오는 신뢰할 수 없는 입력**이다. AI raw 출력과 같은
 * 규칙을 적용한다 — 반드시 이 스키마로 validate 한 뒤에만 쓴다.
 *
 * 여기 있는 것은 "선 위의 형태"뿐이다. 어떤 메시지를 무엇으로 해석할지는
 * `@bolsaram/domain` 의 `classifyTelegramMessage` 가 정한다. Import 코어가
 * Bot API 타입을 직접 알지 않게 하려는 경계다.
 *
 * 스키마는 우리가 쓰는 필드만 선언한다. Zod 는 선언하지 않은 키를 조용히 버리므로
 * 텔레그램이 필드를 추가해도 깨지지 않는다.
 */
import { z } from "zod";

/**
 * 봇이 getFile 로 내려받을 수 있는 파일 상한. 20MB 는 Bot API 의 제약이며
 * 우리 업로드 상한(25MB)보다 작다. 초과분은 봇에서 안내하고 웹 업로드로 보낸다.
 */
export const TELEGRAM_MAX_FILE_BYTES = 20 * 1024 * 1024;

/** 한 세션에 받을 사진 상한. import_assets 의 sort_order 와 같은 범위를 쓴다. */
export const TELEGRAM_MAX_ASSETS_PER_SESSION = 20;

/**
 * 텔레그램 사용자/대화 id. 2^53 을 넘지 않으므로 number 로 다룬다
 * (DB 에는 bigint 로 저장한다).
 */
const telegramIdSchema = z.number().int().min(-9_007_199_254_740_991).max(9_007_199_254_740_991);

export const telegramPhotoSizeSchema = z.object({
  file_id: z.string().min(1).max(400),
  file_unique_id: z.string().min(1).max(200),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  file_size: z.number().int().nonnegative().optional(),
});
export type TelegramPhotoSize = z.infer<typeof telegramPhotoSizeSchema>;

export const telegramDocumentSchema = z.object({
  file_id: z.string().min(1).max(400),
  file_unique_id: z.string().min(1).max(200),
  file_name: z.string().max(400).optional(),
  mime_type: z.string().max(200).optional(),
  file_size: z.number().int().nonnegative().optional(),
});
export type TelegramDocument = z.infer<typeof telegramDocumentSchema>;

export const telegramMessageSchema = z.object({
  message_id: z.number().int(),
  from: z
    .object({
      id: telegramIdSchema,
      is_bot: z.boolean().optional(),
      /** 관리자 UI 에 노출하지 않는다. 봇 응답 문구에만 쓴다. */
      first_name: z.string().max(200).optional(),
      username: z.string().max(200).optional(),
    })
    .optional(),
  chat: z.object({
    id: telegramIdSchema,
    type: z.string().max(40),
  }),
  date: z.number().int(),
  text: z.string().max(20_000).optional(),
  caption: z.string().max(20_000).optional(),
  /** 앨범으로 보낸 사진들이 공유하는 식별자. 대화 안에서만 유일하다. */
  media_group_id: z.string().max(200).optional(),
  /** 해상도별 변형 목록. 마지막 원소가 가장 크다. */
  photo: z.array(telegramPhotoSizeSchema).max(20).optional(),
  document: telegramDocumentSchema.optional(),
});
export type TelegramMessage = z.infer<typeof telegramMessageSchema>;

/**
 * webhook 본문. `update_id` 는 봇 단위로 유일하고 증가하며 중복 처리 방지에 쓴다.
 * 우리가 쓰지 않는 update 종류(콜백·인라인 등)는 message 가 비어 있는 형태로 들어와
 * 그대로 무시된다.
 */
export const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: telegramMessageSchema.optional(),
  edited_message: telegramMessageSchema.optional(),
});
export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

/** getFile 응답. file_path 로 만드는 다운로드 링크는 최소 1시간만 유효하다. */
export const telegramFileResponseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    file_id: z.string().min(1),
    file_unique_id: z.string().min(1),
    file_size: z.number().int().nonnegative().optional(),
    file_path: z.string().min(1).max(400).optional(),
  }),
});
export type TelegramFile = z.infer<typeof telegramFileResponseSchema>["result"];

/** 연결 코드 발급 요청. 만료는 서버가 정한다. */
export const issueTelegramLinkCodeSchema = z.object({});
