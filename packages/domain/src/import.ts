/**
 * Import 세션 상태 기계와 정규화 규칙
 * (설계문서 §3·§11, 모바일 가이드 「신뢰성」).
 *
 *   RECEIVED → UPLOADING → ANALYZING → REVIEW_REQUIRED | READY → IMPORTED
 *                                  └────────── FAILED ←──────────┘
 */
import {
  LOW_CONFIDENCE_THRESHOLD,
  REQUIRED_FIELDS_FOR_COMMIT,
  type ExtractedFields,
  type ExtractionConfidence,
  type ImportStatus,
} from "@bolsaram/schemas";
import { DomainError } from "./errors";

const ALLOWED_IMPORT_TRANSITIONS: Record<ImportStatus, readonly ImportStatus[]> = {
  RECEIVED: ["UPLOADING", "ANALYZING", "FAILED"],
  UPLOADING: ["UPLOADING", "ANALYZING", "RECEIVED", "FAILED"],
  ANALYZING: ["REVIEW_REQUIRED", "READY", "FAILED"],
  REVIEW_REQUIRED: ["ANALYZING", "READY", "IMPORTED", "FAILED"],
  READY: ["ANALYZING", "REVIEW_REQUIRED", "IMPORTED", "FAILED"],
  // 등록 완료는 종착점이다. 재등록은 새 세션을 만든다.
  IMPORTED: [],
  // 실패는 재시도로 되돌릴 수 있어야 한다(모바일 가이드 「신뢰성」).
  FAILED: ["UPLOADING", "ANALYZING", "RECEIVED"],
};

export function assertImportTransition(from: ImportStatus, to: ImportStatus): void {
  if (from === to) return;
  const allowed = ALLOWED_IMPORT_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new DomainError(
      "INVALID_STATE",
      `Import 상태를 ${from} → ${to} 로 바꿀 수 없습니다.`,
      { from, to, allowed },
    );
  }
}

export type FieldReview = {
  key: keyof ExtractedFields;
  confidence: number;
  /** 값이 없거나 신뢰도가 낮아 사람이 확인해야 하는 필드. */
  needsAttention: boolean;
  /** 값이 없으면 commit 자체를 막는 필수 필드. */
  required: boolean;
};

/** 관리자 검토 화면이 쓰는 필드별 판정. */
export function reviewFields(
  fields: ExtractedFields,
  confidence: ExtractionConfidence,
): FieldReview[] {
  return (Object.keys(fields) as (keyof ExtractedFields)[]).map((key) => {
    const value = fields[key];
    const score = confidence[key] ?? 0;
    const isEmpty = value == null || (Array.isArray(value) && value.length === 0);
    const required = (REQUIRED_FIELDS_FOR_COMMIT as readonly string[]).includes(key);
    return {
      key,
      confidence: score,
      needsAttention: isEmpty ? required : score < LOW_CONFIDENCE_THRESHOLD,
      required,
    };
  });
}

/** AI 결과를 곧바로 게시하지 않기 위한 판정: 하나라도 확인 필요면 REVIEW_REQUIRED. */
export function statusAfterExtraction(
  fields: ExtractedFields,
  confidence: ExtractionConfidence,
): Extract<ImportStatus, "READY" | "REVIEW_REQUIRED"> {
  return reviewFields(fields, confidence).some((f) => f.needsAttention)
    ? "REVIEW_REQUIRED"
    : "READY";
}

/** commit 가능 여부. 비어 있으면 안 되는 필드를 알려준다. */
export function missingRequiredFields(fields: ExtractedFields): (keyof ExtractedFields)[] {
  return REQUIRED_FIELDS_FOR_COMMIT.filter((key) => fields[key] == null);
}

/**
 * commit 가능 여부를 판정한다.
 *
 * `publish` 는 곧바로 공개(ACTIVE/LISTED)한다는 뜻이므로 더 엄격하다.
 * 확인이 필요한 항목이 남은 채로는 공개할 수 없다 — 설계문서 §11 「AI 결과는 자동
 * 공개하지 않는다」를 UI 가 아니라 여기서 강제한다.
 */
export function assertCommittable(
  status: ImportStatus,
  fields: ExtractedFields,
  options: { publish?: boolean } = {},
): void {
  if (status === "IMPORTED") {
    throw new DomainError("CONFLICT", "이미 등록된 Import 세션입니다.");
  }
  if (status !== "READY" && status !== "REVIEW_REQUIRED") {
    throw new DomainError("INVALID_STATE", `검토가 끝나지 않았습니다(현재 ${status}).`, {
      status,
    });
  }
  const missing = missingRequiredFields(fields);
  if (missing.length > 0) {
    throw new DomainError("VALIDATION", "필수 항목이 비어 있습니다.", { missing });
  }
  if (options.publish && status !== "READY") {
    throw new DomainError(
      "INVALID_STATE",
      "확인이 필요한 항목이 남아 있어 바로 공개할 수 없습니다. 검토를 끝내거나 비공개로 등록해 주세요.",
      { status },
    );
  }
}

/**
 * 카카오톡에서 복사한 프로필 글을 분석에 넣기 전에 다듬는다.
 * - CRLF 정규화, 제로폭 문자 제거
 * - 카카오톡이 붙이는 `[이름] [오후 3:12]` 말머리 제거
 * - 3줄 이상 연속 공백 축약
 * 원문 자체는 별도 컬럼에 그대로 보관하고, 이 결과는 프롬프트 입력에만 쓴다.
 */
export function normalizeRawText(input: string): string {
  return (
    input
      .replace(/\r\n?/g, "\n")
      // 제로폭 공백·결합자·BOM (U+200B–U+200D, U+FEFF)
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .split("\n")
      .map((line) => line.replace(/^\[[^\]]{1,30}\]\s*\[[^\]]{1,20}\]\s*/, "").trimEnd())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** 업로드 순서를 0부터 빈틈없이 다시 매긴다. 재시도로 구멍이 생겨도 순서를 보존한다. */
export function resequence<T extends { order: number }>(items: T[]): T[] {
  return [...items]
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ ...item, order: index }));
}
