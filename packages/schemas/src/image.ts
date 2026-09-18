/**
 * 이미지 업로드의 공통 모양.
 *
 * 올리는 곳이 어디든 두 단계다 — **슬롯을 받고(서버가 키와 uploadUrl 을 정한다),
 * 파일을 올린 뒤 확정한다.** 확정 시점에만 DB 가 그 키를 가리키므로 실패한 업로드가
 * 깨진 사진으로 남지 않는다.
 *
 * 프로필 사진(`profile.ts`)·주선자 프로필 사진·모임 사진이 모두 이 모양을 쓴다.
 * 어떤 형식을 받는지와 상한은 서버가 정한다(`server/storage/local.ts`) — 여기서는
 * 모양만 본다.
 */
import { z } from "zod";

export const imageSlotSchema = z.object({
  mimeType: z.string().min(1).max(100),
  size: z.number().int().positive(),
});
export type ImageSlot = z.infer<typeof imageSlotSchema>;

export const imageConfirmSchema = z.object({
  confirm: z.object({
    key: z.string().min(1).max(400),
    mimeType: z.string().min(1).max(100),
  }),
});

/** 슬롯 요청과 확정을 한 엔드포인트에서 받는 경우. */
export const imageUploadSchema = z.union([imageConfirmSchema, imageSlotSchema]);
export type ImageUpload = z.infer<typeof imageUploadSchema>;
