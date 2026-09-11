/** Import 파이프라인 입출력 스키마 (설계문서 §10, 모바일 가이드). */
import { z } from "zod";
import { IMPORT_ASSET_TYPES, IMPORT_SOURCES } from "./enums";
import { extractedFieldsSchema } from "./extraction";
import { uuidSchema } from "./profile";

/**
 * 모바일/웹 공유 진입점이 공통으로 쓰는 payload
 * (부트스트랩 프롬프트 §1, 모바일 가이드 「공통 모델」).
 * 서버는 uri 를 직접 읽지 않는다 — 클라이언트가 signed upload 로 올린다.
 */
export const incomingSharePayloadSchema = z.object({
  text: z.string().max(20_000).optional(),
  assets: z
    .array(
      z.object({
        uri: z.string().min(1),
        mimeType: z.string().max(120).optional(),
        name: z.string().max(255).optional(),
        order: z.number().int().min(0),
      }),
    )
    .max(20)
    .default([]),
});
export type IncomingSharePayload = z.infer<typeof incomingSharePayloadSchema>;

export const createImportSessionSchema = z.object({
  source: z.enum(IMPORT_SOURCES).default("MANUAL_UPLOAD"),
  /**
   * 어느 모임에 등록할지. **키를 생략할 수 없다** — `null` 이면 전체공개다.
   *
   * 예전에는 보내지 않으면 서버가 「지금 보고 있는 방」으로 조용히 정했다. 방이
   * 여러 개가 된 뒤로는 그 기본값이 자주 틀렸고, 틀린 것을 검토 화면에 가서야
   * 알게 됐다. 그래서 올리는 쪽이 항상 말하게 한다.
   */
  groupId: z.uuid().nullable(),
  rawText: z.string().max(20_000).optional(),
  /** 클라이언트가 올릴 파일 목록을 미리 알려주면 signed upload 슬롯을 함께 발급한다. */
  assets: z
    .array(
      z.object({
        filename: z.string().trim().min(1).max(255),
        mimeType: z.string().trim().min(1).max(120),
        size: z
          .number()
          .int()
          .min(1)
          .max(25 * 1024 * 1024),
        order: z.number().int().min(0),
      }),
    )
    .max(20)
    .default([]),
});
export type CreateImportSessionInput = z.infer<typeof createImportSessionSchema>;

/**
 * 가져온 것을 어느 모임에 등록할지 바꾼다. `null` 이면 전체공개다.
 *
 * 세션을 만들 때 보고 있던 모임이 그대로 들어가지만, 검토하다가 다른 방에 넣기로
 * 정할 수 있다. 서버는 호출자가 그 모임에 속하는지 확인하고 RLS 가 한 번 더 본다.
 */
export const updateImportGroupSchema = z.object({
  groupId: z.uuid().nullable(),
});

export const registerImportAssetSchema = z.object({
  type: z.enum(IMPORT_ASSET_TYPES).default("IMAGE"),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  size: z
    .number()
    .int()
    .min(1)
    .max(25 * 1024 * 1024),
  order: z.number().int().min(0),
});

export const updateImportTextSchema = z.object({
  rawText: z.string().max(20_000),
});

/** 관리자 검토 저장. AI 가 채운 값을 사람이 덮어쓴다. */
export const updateExtractionSchema = z.object({
  fields: extractedFieldsSchema.partial(),
});

/** commit 은 idempotent 해야 한다(부트스트랩 §8). 같은 키로 두 번 호출해도 프로필은 하나다. */
export const commitImportSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
  /** 지정하면 새 프로필 대신 기존 프로필을 갱신한다. */
  targetProfileId: uuidSchema.optional(),
  /** 게시 여부. 기본은 비공개로 만들고 관리자가 따로 공개한다(자동 게시 금지). */
  publish: z.boolean().default(false),
});
export type CommitImportInput = z.infer<typeof commitImportSchema>;
