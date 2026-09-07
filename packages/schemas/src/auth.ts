/** 인증/초대 스키마. Supabase Auth 대신 자체 세션을 쓴다. */
import { z } from "zod";

/** 국내 휴대폰 번호를 숫자만 남긴 형태로 정규화한다. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[^0-9]/g, ""))
  .pipe(z.string().regex(/^01[016789][0-9]{7,8}$/, "휴대폰 번호 형식이 아닙니다."));

export const adminLoginSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(8).max(200),
});

export const requestOtpSchema = z.object({
  phone: phoneSchema,
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, "6자리 숫자를 입력하세요."),
});

export const inviteCreateSchema = z.object({
  profileId: z.uuid(),
  /** 초대 유효기간(시간). 기본 72시간. */
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(72),
});

export const inviteClaimSchema = z.object({
  token: z.string().trim().min(20).max(200),
});

export const displayNameSchema = z.string().trim().min(1).max(40);
