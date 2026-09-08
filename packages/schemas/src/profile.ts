/** Profile 관련 입출력 스키마 (설계문서 §9, §10). */
import { z } from "zod";
import {
  DRINKING_LEVELS,
  GENDERS,
  JOB_CATEGORIES,
  MBTI_TYPES,
  PROFILE_STATUSES,
  RECORDABLE_CONSENT_METHODS,
  REGIONS,
  RELIGIONS,
  SMOKING_LEVELS,
  VISIBILITIES,
} from "./enums";
import { BIRTH_YEAR_MAX, BIRTH_YEAR_MIN, HEIGHT_MAX, HEIGHT_MIN } from "./extraction";

export const uuidSchema = z.uuid();

/** 사용자에게 노출되는 익명 코드. 예: `#17` 의 `17`. */
export const publicCodeSchema = z.number().int().positive();

const nullableTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable();

export const profileWritableSchema = z.object({
  gender: z.enum(GENDERS),
  birthYear: z.number().int().min(BIRTH_YEAR_MIN).max(BIRTH_YEAR_MAX),
  height: z.number().int().min(HEIGHT_MIN).max(HEIGHT_MAX).nullable(),
  jobTitle: nullableTrimmed(120),
  jobCategory: z.enum(JOB_CATEGORIES).nullable(),
  company: nullableTrimmed(120),
  education: nullableTrimmed(200),
  residenceRegion: z.enum(REGIONS),
  workplaceRegion: z.enum(REGIONS).nullable(),
  religion: z.enum(RELIGIONS).nullable(),
  mbti: z.enum(MBTI_TYPES).nullable(),
  smoking: z.enum(SMOKING_LEVELS).nullable(),
  drinking: z.enum(DRINKING_LEVELS).nullable(),
  hobbies: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  bio: nullableTrimmed(2000),
  idealTypeText: nullableTrimmed(2000),
  /** 이름/연락처는 INTRODUCED 이후에만 공개된다(설계문서 §5). */
  realName: nullableTrimmed(60),
  contactNote: nullableTrimmed(200),
});
export type ProfileWritable = z.infer<typeof profileWritableSchema>;

export const profileUpdateSchema = profileWritableSchema.partial();
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const profileStatusUpdateSchema = z.object({
  status: z.enum(PROFILE_STATUSES),
  visibility: z.enum(VISIBILITIES).optional(),
  reason: z.string().trim().max(300).optional(),
});

/**
 * 등록 동의 기록 (마이그레이션 0019).
 * 주선자가 **직접 확인한 방법만** 고를 수 있다 — SYNTHETIC·LEGACY 는 시스템이 붙인
 * 표식이라 입력으로 받지 않는다.
 */
export const consentRecordSchema = z.object({
  method: z.enum(RECORDABLE_CONSENT_METHODS),
  /** 확인한 시각. 미래는 받지 않는다 — 아직 받지 않은 동의를 기록할 수 없다. */
  confirmedAt: z.iso
    .datetime({ offset: true })
    .refine((v) => new Date(v).getTime() <= Date.now() + 60_000, "미래 시각은 기록할 수 없습니다."),
  /** 어떻게 확인했는지 한 줄. 대화 원문을 옮겨 적는 자리가 아니다. */
  note: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
});
export type ConsentRecord = z.infer<typeof consentRecordSchema>;

/** Discover 필터 (설계문서 §4 탐색). 쿼리스트링에서 오므로 문자열을 강제 변환한다. */
const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.enum(values))])
    .optional()
    .transform((v) => {
      if (v == null) return undefined;
      const list = Array.isArray(v) ? v : v.split(",");
      const cleaned = list.map((s) => s.trim()).filter((s) => s.length > 0);
      return cleaned.length > 0 ? cleaned : undefined;
    })
    .pipe(z.array(z.enum(values)).optional());

const intParam = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).optional();

export const DISCOVER_PAGE_SIZE = 24;

export const discoverQuerySchema = z.object({
  gender: z.enum(GENDERS).optional(),
  ageMin: intParam(18, 99),
  ageMax: intParam(18, 99),
  heightMin: intParam(HEIGHT_MIN, HEIGHT_MAX),
  heightMax: intParam(HEIGHT_MIN, HEIGHT_MAX),
  regions: csv(REGIONS),
  jobCategories: csv(JOB_CATEGORIES),
  religions: csv(RELIGIONS),
  smoking: csv(SMOKING_LEVELS),
  drinking: csv(DRINKING_LEVELS),
  q: z.string().trim().max(60).optional(),
  cursor: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(DISCOVER_PAGE_SIZE),
});
export type DiscoverQuery = z.infer<typeof discoverQuerySchema>;

/** 관리자 프로필 목록 필터. 회원 필터와 달리 status/visibility 를 직접 다룬다. */
export const adminProfileQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  status: csv(PROFILE_STATUSES),
  gender: z.enum(GENDERS).optional(),
  claimed: z.enum(["yes", "no"]).optional(),
  /** pending = 등록 동의를 아직 확인하지 않은 것(확인 필요·기록 없음). */
  consent: z.enum(["pending"]).optional(),
  cursor: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminProfileQuery = z.infer<typeof adminProfileQuerySchema>;
