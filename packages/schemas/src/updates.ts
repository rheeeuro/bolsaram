import { z } from "zod";

/**
 * 업데이트 소식(`docs/guide/updates.md`)의 주간 항목 — AI 응답 검증과 모델에 보내는
 * JSON Schema 의 단일 원본. 주간 작업(`scripts/updates-weekly.ts`)이 쓴다.
 */

/** 한 주에 싣는 항목 상한. 그보다 많으면 묶어 쓰라고 프롬프트가 요구한다. */
export const UPDATE_ITEMS_MAX = 8;
/** 항목 한 줄의 길이 상한. 화면에서 두세 줄을 넘기면 소식이 아니라 설명서가 된다. */
export const UPDATE_ITEM_MAX_LENGTH = 300;

export const updateItemsSchema = z.object({
  items: z.array(z.string().trim().min(1).max(UPDATE_ITEM_MAX_LENGTH)).max(UPDATE_ITEMS_MAX),
});

export type UpdateItems = z.infer<typeof updateItemsSchema>;

/** OpenAI strict 모드용. 길이·개수는 strict 가 받지 않으므로 응답 뒤 Zod 가 본다. */
export const updateItemsJsonSchema = {
  type: "object",
  properties: { items: { type: "array", items: { type: "string" } } },
  required: ["items"],
  additionalProperties: false,
} as const;
