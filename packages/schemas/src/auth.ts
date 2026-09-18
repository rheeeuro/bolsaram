/** 인증/초대 스키마. Supabase Auth 대신 자체 세션을 쓴다. */
import { z } from "zod";

/** 국내 휴대폰 번호를 숫자만 남긴 형태로 정규화한다. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[^0-9]/g, ""))
  .pipe(z.string().regex(/^01[016789][0-9]{7,8}$/, "휴대폰 번호 형식이 아닙니다."));

/**
 * 주선자 로그인에 쓰는 소셜 제공자. DB 의 `oauth_provider` enum 과 같은 값이다.
 *
 * 우리는 비밀번호를 받지 않는다 — 처음 들어온 제공자 계정이 곧 가입이고, 그 뒤로는
 * 같은 버튼이 로그인이다. 그래서 로그인 스키마와 가입 스키마가 따로 없다.
 */
export const OAUTH_PROVIDERS = ["KAKAO", "GOOGLE"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** 화면과 URL 에서는 소문자로 쓴다(`/api/auth/oauth/kakao/start`). */
export const OAUTH_PROVIDER_LABELS: Record<OAuthProvider, string> = {
  KAKAO: "카카오",
  GOOGLE: "구글",
};

/** URL 구간으로 들어온 제공자 이름. 대소문자를 가리지 않고 받아 enum 값으로 맞춘다. */
export const oauthProviderSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.enum(OAUTH_PROVIDERS));

/** 모임 이름·설명. `groups` 의 CHECK 와 같은 범위를 쓴다. */
export const groupNameSchema = z.string().trim().min(1).max(80);
export const groupDescriptionSchema = z.string().trim().max(500);

export const groupCreateSchema = z.object({
  name: groupNameSchema,
  description: groupDescriptionSchema.optional(),
});

/** 수정. 보낸 필드만 바꾼다 — 설명을 빈 문자열로 보내면 지운다. */
export const groupUpdateSchema = z
  .object({
    name: groupNameSchema.optional(),
    description: groupDescriptionSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined, {
    message: "바꿀 항목이 없습니다.",
  });

/**
 * 보고 있는 모임(채널) 전환. `null` 이면 전체공개다.
 *
 * 권한을 주는 값이 아니다 — 어느 모임을 볼 수 있는지는 RLS 가 정하고, 서버는 여기
 * 들어온 모임에 실제로 속해 있는지 다시 확인한다.
 */
export const groupActivateSchema = z.object({
  groupId: z.uuid().nullable(),
});

/** 동료 주선자가 준 초대 코드. 여러 모임에 동시에 속할 수 있다. */
export const groupJoinSchema = z.object({
  code: z.string().trim().min(8).max(200),
});

/**
 * 모임의 주선자 한 명을 다룬다. 대상은 경로에 있고 본문은 무엇을 할지만 담는다.
 *
 * 지금은 모임장 넘기기 하나뿐이라 값이 고정이다 — 모임장을 **스스로 내려놓는** 경로는
 * 두지 않는다. 모임마다 모임장이 꼭 한 명 있어야 해서(`group_admins_one_owner`)
 * 넘길 사람을 반드시 골라야 한다.
 */
export const groupAdminUpdateSchema = z.object({
  isOwner: z.literal(true),
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

/**
 * 대행 시작 — 주선자가 대신 조작할 프로필.
 *
 * 대상이 아직 아무 계정에도 연결되지 않았는지, 호출자가 그 프로필을 다룰 수 있는지는
 * 서버와 RLS 가 판정한다. 여기서는 모양만 본다.
 */
export const actingStartSchema = z.object({
  profileId: z.uuid(),
});
export type ActingStart = z.infer<typeof actingStartSchema>;

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
