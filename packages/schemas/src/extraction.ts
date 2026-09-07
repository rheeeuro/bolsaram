/**
 * AI 프로필 추출 스키마 — single source of truth (부트스트랩 프롬프트 §9).
 *
 * 규칙:
 *  - 명시되지 않은 값은 추론하지 않고 null 을 반환한다.
 *  - 모든 필드는 nullable 이며, 필드별 confidence 를 별도로 저장한다.
 *  - 모델의 raw 출력은 반드시 이 스키마로 validate 한 뒤에만 사용한다.
 */
import { z } from "zod";
import {
  DRINKING_LEVELS,
  GENDERS,
  JOB_CATEGORIES,
  MBTI_TYPES,
  REGIONS,
  RELIGIONS,
  SMOKING_LEVELS,
} from "./enums";

/** 출생연도 허용 범위. 이 범위를 벗어난 모델 출력은 신뢰하지 않고 null 로 떨군다. */
export const BIRTH_YEAR_MIN = 1960;
export const BIRTH_YEAR_MAX = new Date().getFullYear() - 18;
export const HEIGHT_MIN = 130;
export const HEIGHT_MAX = 220;

export const extractedFieldsSchema = z.object({
  gender: z.enum(GENDERS).nullable(),
  birthYear: z.number().int().min(BIRTH_YEAR_MIN).max(BIRTH_YEAR_MAX).nullable(),
  height: z.number().int().min(HEIGHT_MIN).max(HEIGHT_MAX).nullable(),
  jobTitle: z.string().trim().max(120).nullable(),
  jobCategory: z.enum(JOB_CATEGORIES).nullable(),
  company: z.string().trim().max(120).nullable(),
  education: z.string().trim().max(200).nullable(),
  residenceRegion: z.enum(REGIONS).nullable(),
  workplaceRegion: z.enum(REGIONS).nullable(),
  religion: z.enum(RELIGIONS).nullable(),
  mbti: z.enum(MBTI_TYPES).nullable(),
  smoking: z.enum(SMOKING_LEVELS).nullable(),
  drinking: z.enum(DRINKING_LEVELS).nullable(),
  hobbies: z.array(z.string().trim().min(1).max(40)).max(12).nullable(),
  bio: z.string().trim().max(2000).nullable(),
  idealTypeText: z.string().trim().max(2000).nullable(),
});

export type ExtractedFields = z.infer<typeof extractedFieldsSchema>;

export const EXTRACTED_FIELD_KEYS = Object.keys(
  extractedFieldsSchema.shape,
) as (keyof ExtractedFields)[];

/** 필드별 신뢰도 0..1. 값이 null 인 필드는 0 에 가깝게 온다. */
export const extractionConfidenceSchema = z.partialRecord(
  z.enum(EXTRACTED_FIELD_KEYS as [string, ...string[]]),
  z.number().min(0).max(1),
);
export type ExtractionConfidence = Partial<Record<keyof ExtractedFields, number>>;

/** 모델이 돌려줘야 하는 최상위 구조. */
export const extractionResultSchema = z.object({
  fields: extractedFieldsSchema,
  confidence: extractionConfidenceSchema,
  /** 모델이 판단하지 못했거나 사람이 확인해야 하는 지점. 관리자 검토 화면에 그대로 노출한다. */
  notes: z.array(z.string().trim().max(300)).max(10).default([]),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

/** 이 값 미만이면 관리자 검토 화면에서 '확인 필요'로 강조한다. */
export const LOW_CONFIDENCE_THRESHOLD = 0.65;

/** 게시 전에 사람이 반드시 확인해야 하는 필드. 하나라도 비어 있으면 commit 을 막는다. */
export const REQUIRED_FIELDS_FOR_COMMIT = [
  "gender",
  "birthYear",
  "residenceRegion",
] as const satisfies readonly (keyof ExtractedFields)[];

/**
 * 모델에 요청할 때 쓰는 스키마.
 * 검증용 `extractionResultSchema` 와 필드 목록은 같지만, confidence 를 record 가 아니라
 * 전 필드가 명시된 object 로 둔다 — OpenAI strict 모드가 record(additionalProperties 스키마)를
 * 허용하지 않기 때문이다. 검증은 계속 관대한 쪽(partialRecord)을 쓴다.
 */
const modelConfidenceSchema = z.object(
  Object.fromEntries(EXTRACTED_FIELD_KEYS.map((k) => [k, z.number().min(0).max(1)])) as Record<
    keyof ExtractedFields,
    z.ZodNumber
  >,
);

const modelExtractionResultSchema = z.object({
  fields: extractedFieldsSchema,
  confidence: modelConfidenceSchema,
  notes: z.array(z.string().max(300)),
});

/**
 * OpenAI Structured Outputs(strict) 규격으로 정규화한 JSON Schema.
 * strict 모드는 모든 object 에 대해 additionalProperties:false 와
 * 전체 프로퍼티의 required 명시를 요구하므로 Zod 출력에 후처리를 건다.
 */
export function toStrictJsonSchema(): Record<string, unknown> {
  const raw = z.toJSONSchema(modelExtractionResultSchema, {
    target: "draft-2020-12",
    io: "output",
  }) as Record<string, unknown>;
  return normalizeStrict(raw) as Record<string, unknown>;
}

function normalizeStrict(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalizeStrict);
  if (node === null || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out[key] = normalizeStrict(value);
  }

  if (out.type === "object" && out.properties && typeof out.properties === "object") {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as Record<string, unknown>);
  }
  // strict 모드는 default 를 지원하지 않는다.
  delete out.default;
  return out;
}

/** 전 필드 null 인 빈 결과. 프로바이더 실패 시 fallback 이 아니라 초기값 용도로만 쓴다. */
export function emptyExtractedFields(): ExtractedFields {
  return Object.fromEntries(EXTRACTED_FIELD_KEYS.map((k) => [k, null])) as ExtractedFields;
}
