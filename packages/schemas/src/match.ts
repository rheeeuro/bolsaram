/** MatchRequest / Favorite 입출력 스키마 (설계문서 §10). */
import { z } from "zod";
import { uuidSchema } from "./profile";

export const createMatchRequestSchema = z.object({
  targetProfileId: uuidSchema,
  /** 신청 시 남기는 한 줄. 상대가 수락 결정을 할 때 함께 본다. */
  message: z.string().trim().max(200).optional(),
});
export type CreateMatchRequestInput = z.infer<typeof createMatchRequestSchema>;

export const matchRequestDirectionSchema = z.enum(["incoming", "outgoing", "connected"]);
export type MatchRequestDirection = z.infer<typeof matchRequestDirectionSchema>;

export const matchRequestListQuerySchema = z.object({
  direction: matchRequestDirectionSchema.default("incoming"),
});

export const rejectMatchRequestSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});

export const favoriteToggleSchema = z.object({
  profileId: uuidSchema,
});

/** 숨기기 토글. 대상은 프로필 하나이고 관계는 양방향으로 적용된다. */
export const profileHideSchema = z.object({
  profileId: uuidSchema,
});
