/**
 * Import 세션 상태 기계와 정규화 규칙
 * (설계문서 §3·§11, 모바일 가이드 「신뢰성」).
 *
 *   RECEIVED → UPLOADING → ANALYZING → REVIEW_REQUIRED | READY → IMPORTED
 *                                  └────────── FAILED ←──────────┘
 */
import {
  EXTRACTED_FIELD_REVIEW_ORDER,
  LOW_CONFIDENCE_THRESHOLD,
  REQUIRED_FIELDS_FOR_COMMIT,
  type ExtractedFields,
  type ExtractionConfidence,
  type ImportStatus,
} from "@bolsaram/schemas";
import { DomainError } from "./errors";

/**
 * 등록하지 않은 가져오기(검토 대기)를 남겨 두는 시간. 마지막으로 손댄 뒤 이만큼 지나면
 * 정리 작업이 세션과 원본 사진을 지운다 — 미등록 원문·사진을 오래 쥐고 있지 않는다.
 */
export const PENDING_IMPORT_TTL_HOURS = 24;

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
  // 저장값의 키 순서가 아니라 정해 둔 순서로 늘어놓는다 — JSONB 는 키를 길이순으로 섞는다.
  return EXTRACTED_FIELD_REVIEW_ORDER.map((key) => {
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

/**
 * AI 결과를 곧바로 게시하지 않기 위한 판정: 하나라도 확인 필요면 REVIEW_REQUIRED.
 * `disputed` 는 다시 판정한 값이 추출 값과 엇갈린 항목이다 — 빈 칸이어도 사람이 본다.
 */
export function statusAfterExtraction(
  fields: ExtractedFields,
  confidence: ExtractionConfidence,
  disputed: readonly (keyof ExtractedFields)[] = [],
): Extract<ImportStatus, "READY" | "REVIEW_REQUIRED"> {
  return disputed.length > 0 || reviewFields(fields, confidence).some((f) => f.needsAttention)
    ? "REVIEW_REQUIRED"
    : "READY";
}

/**
 * 보기가 정해진 항목. 추출과 따로 Decisions API 로 다시 물어 보정된 확률을 받는다.
 * 구·시·군(보기 50여 개)과 MBTI(글자 그대로 적힌다)는 넣지 않는다.
 */
export const JUDGED_FIELDS = [
  "gender",
  "jobCategory",
  "residenceRegion",
  "workplaceRegion",
  "religion",
  "smoking",
  "drinking",
] as const satisfies readonly (keyof ExtractedFields)[];
export type JudgedField = (typeof JUDGED_FIELDS)[number];

/** 한 항목을 다시 판정한 결과. `null` 은 「원문에 적혀 있지 않다」를 고른 것이다. */
export type FieldJudgement = {
  choice: string | null;
  probabilities: { value: string | null; probability: number }[];
};

export type FieldDispute = {
  field: JudgedField;
  extracted: string | null;
  suggested: string | null;
  probability: number;
};

/**
 * 추출 모델이 스스로 매긴 신뢰도를 다시 판정한 확률로 바꾼다.
 *
 * 값이 있는 항목은 그 값의 확률이 곧 신뢰도다 — 자기 신고 점수보다 기준선(65%)에
 * 맞춰 쓰기 좋다. 빈 항목의 신뢰도는 그대로 둔다(빈 칸 판정은 필수 여부가 정한다).
 * 다시 판정한 값이 기준선 이상으로 추출 값과 다르면 엇갈림으로 돌려준다.
 * **값은 바꾸지 않는다** — 고치는 것은 주선자다.
 */
export function calibrateConfidence(
  fields: ExtractedFields,
  confidence: ExtractionConfidence,
  judgements: Partial<Record<JudgedField, FieldJudgement>>,
): { confidence: ExtractionConfidence; disputes: FieldDispute[] } {
  const next: ExtractionConfidence = { ...confidence };
  const disputes: FieldDispute[] = [];
  const probabilityOf = (j: FieldJudgement, value: string | null) =>
    j.probabilities.find((p) => p.value === value)?.probability ?? 0;

  for (const field of JUDGED_FIELDS) {
    const judgement = judgements[field];
    if (!judgement) continue;
    const extracted = fields[field] ?? null;
    if (extracted != null) next[field] = probabilityOf(judgement, extracted);
    const suggestedProbability = probabilityOf(judgement, judgement.choice);
    if (judgement.choice !== extracted && suggestedProbability >= LOW_CONFIDENCE_THRESHOLD) {
      disputes.push({
        field,
        extracted,
        suggested: judgement.choice,
        probability: suggestedProbability,
      });
    }
  }
  return { confidence: next, disputes };
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
 * - 주선 방 공지(「🌸클린메세지🌸」 블록) 제거
 * - 3줄 이상 연속 공백 축약
 * 원문 자체는 별도 컬럼에 그대로 보관하고, 이 결과는 프롬프트 입력에만 쓴다.
 */
export function normalizeRawText(input: string): string {
  const lines = input
    .replace(/\r\n?/g, "\n")
    // 제로폭 공백·결합자·BOM (U+200B–U+200D, U+FEFF)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .split("\n")
    .map((line) => line.replace(/^\[[^\]]{1,30}\]\s*\[[^\]]{1,20}\]\s*/, "").trimEnd());
  return stripHouseNotices(lines)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 공지 머리줄. 「🌸클린메세지🌸」처럼 꾸밈 문자가 붙고 「메시지」로도 쓴다. */
const NOTICE_HEADER = /^[^\p{L}\p{N}]*클린\s*메[세시]지[^\p{L}\p{N}]*$/u;
/** 머리줄 뒤 공지 본문으로 보는 줄. 다음 사람 글이 빈 줄 없이 바로 이어 붙기도 해서 낱말로 가린다. */
const NOTICE_BODY = /에티켓|매너|파투|잠수|노쇼|회신|답장|주선자에게/u;

/**
 * 주선 방이 프로필마다 붙이는 에티켓 공지를 뺀다. 그 사람의 소개가 아니라서 남겨 두면
 * AI 가 자기소개나 이상형 조건(「빠른회신」을 바라고 「잠수」를 피한다)으로 옮긴다.
 * 머리줄과, 그 바로 뒤에서 공지 낱말이 든 줄(최대 4줄)만 지운다.
 */
function stripHouseNotices(lines: string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!NOTICE_HEADER.test(lines[i]!)) {
      kept.push(lines[i]!);
      continue;
    }
    let skip = 0;
    while (skip < 4 && i + 1 < lines.length && NOTICE_BODY.test(lines[i + 1]!)) {
      i++;
      skip++;
    }
  }
  return kept;
}

/** 이름으로 읽을 줄머리. 카카오톡 프로필 양식에서 실제로 쓰는 표기만 둔다. */
const NAME_LINE = /^\s*[-*·•]?\s*(?:이름|성함|name)\s*[:：=\-)]\s*(.+?)\s*$/iu;

/**
 * 원문의 「이름: ○○○」 줄에서 이름을 꺼낸다. 검토 화면이 이 값으로 이름 칸을 미리 채운다.
 *
 * **AI 에 맡기지 않는다.** 이름은 연결 전까지 가려 두는 값이라 추출 스키마에 넣지 않고,
 * 주선자가 원문에 적어 둔 양식을 규칙으로만 읽는다. 줄머리가 없으면 추측하지 않고 null 이다.
 * 괄호 뒤 덧붙임(`홍길동 (93)`)은 떼고, 60자(저장 상한)를 넘으면 버린다.
 */
export function pickRealName(rawText: string | null | undefined): string | null {
  if (!rawText) return null;
  for (const line of normalizeRawText(rawText).split("\n")) {
    const match = NAME_LINE.exec(line);
    if (!match) continue;
    const name = match[1]!.replace(/\s*[([].*$/u, "").trim();
    if (name.length === 0 || name.length > 60) return null;
    return name;
  }
  return null;
}

/** 업로드 순서를 0부터 빈틈없이 다시 매긴다. 재시도로 구멍이 생겨도 순서를 보존한다. */
export function resequence<T extends { order: number }>(items: T[]): T[] {
  return [...items]
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ ...item, order: index }));
}
