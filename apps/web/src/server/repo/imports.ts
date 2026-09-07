/**
 * Import 파이프라인 저장소 + 서비스.
 * 상태 전이 판정은 @bolsaram/domain 의 assertImportTransition 이 담당한다.
 */
import "server-only";
import type { Sql } from "@bolsaram/db";
import {
  DomainError,
  assertCommittable,
  assertImportTransition,
  normalizeRawText,
  statusAfterExtraction,
} from "@bolsaram/domain";
import {
  emptyExtractedFields,
  extractedFieldsSchema,
  type ExtractedFields,
  type ExtractionConfidence,
  type ImportSource,
  type ImportStatus,
} from "@bolsaram/schemas";

export type ImportSessionRecord = {
  id: string;
  /** 소속 모임. commit 이 만드는 프로필도 같은 모임에 들어간다. */
  groupId: string;
  createdBy: string;
  source: ImportSource;
  status: ImportStatus;
  rawText: string | null;
  errorMessage: string | null;
  committedProfileId: string | null;
  idempotencyKey: string | null;
  committedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ImportAssetRecord = {
  id: string;
  storageKey: string;
  originalFilename: string | null;
  mimeType: string;
  byteSize: number;
  sortOrder: number;
  uploadedAt: Date | null;
};

export type ImportExtractionRecord = {
  id: string;
  fields: ExtractedFields;
  confidence: ExtractionConfidence;
  notes: string[];
  model: string;
  promptVersion: string;
  reviewedFields: Partial<ExtractedFields> | null;
  reviewedAt: Date | null;
  createdAt: Date;
};

type SessionRow = {
  id: string;
  group_id: string;
  created_by: string;
  source: ImportSource;
  status: ImportStatus;
  raw_text: string | null;
  error_message: string | null;
  committed_profile_id: string | null;
  idempotency_key: string | null;
  committed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const SESSION_COLUMNS = `id, group_id, created_by, source, status, raw_text, error_message,
  committed_profile_id, idempotency_key, committed_at, created_at, updated_at`;

function toSession(row: SessionRow): ImportSessionRecord {
  return {
    id: row.id,
    groupId: row.group_id,
    createdBy: row.created_by,
    source: row.source,
    status: row.status,
    rawText: row.raw_text,
    errorMessage: row.error_message,
    committedProfileId: row.committed_profile_id,
    idempotencyKey: row.idempotency_key,
    committedAt: row.committed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createSession(
  sql: Sql,
  input: { groupId: string; createdBy: string; source: ImportSource; rawText?: string },
): Promise<ImportSessionRecord> {
  // group_id 는 RLS 가 요구한다(import_sessions_admin). 넣지 않으면 정책에 걸린다.
  const result = await sql.query<SessionRow>(
    `INSERT INTO import_sessions (group_id, created_by, source, raw_text)
     VALUES ($1, $2, $3, $4) RETURNING ${SESSION_COLUMNS}`,
    [input.groupId, input.createdBy, input.source, input.rawText ?? null],
  );
  return toSession(result.rows[0]!);
}

export async function findSession(sql: Sql, id: string): Promise<ImportSessionRecord | null> {
  const result = await sql.query<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM import_sessions WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? toSession(row) : null;
}

export async function requireSession(sql: Sql, id: string): Promise<ImportSessionRecord> {
  const session = await findSession(sql, id);
  if (!session) throw new DomainError("NOT_FOUND", "Import 세션을 찾을 수 없습니다.");
  return session;
}

export async function listInbox(
  sql: Sql,
  filter: { status?: ImportStatus[] },
): Promise<(ImportSessionRecord & { assetCount: number })[]> {
  const values: unknown[] = [];
  let clause = "TRUE";
  if (filter.status?.length) {
    values.push(filter.status);
    clause = `s.status = ANY($1)`;
  }
  const result = await sql.query<SessionRow & { asset_count: number }>(
    `SELECT ${SESSION_COLUMNS.split(", ")
      .map((c) => `s.${c.trim()}`)
      .join(", ")},
            (SELECT count(*)::int FROM import_assets a WHERE a.import_session_id = s.id) AS asset_count
       FROM import_sessions s
      WHERE ${clause}
      ORDER BY
        CASE s.status
          WHEN 'REVIEW_REQUIRED' THEN 0 WHEN 'READY' THEN 1
          WHEN 'ANALYZING' THEN 2 WHEN 'FAILED' THEN 3 ELSE 4 END,
        s.created_at DESC
      LIMIT 100`,
    values,
  );
  return result.rows.map((row) => ({ ...toSession(row), assetCount: row.asset_count }));
}

export async function setStatus(
  sql: Sql,
  id: string,
  to: ImportStatus,
  errorMessage?: string | null,
): Promise<ImportSessionRecord> {
  const current = await requireSession(sql, id);
  assertImportTransition(current.status, to);
  const result = await sql.query<SessionRow>(
    `UPDATE import_sessions SET status = $2, error_message = $3
      WHERE id = $1 RETURNING ${SESSION_COLUMNS}`,
    [id, to, errorMessage ?? null],
  );
  return toSession(result.rows[0]!);
}

export async function updateRawText(
  sql: Sql,
  id: string,
  rawText: string,
): Promise<ImportSessionRecord> {
  const result = await sql.query<SessionRow>(
    `UPDATE import_sessions SET raw_text = $2 WHERE id = $1 RETURNING ${SESSION_COLUMNS}`,
    [id, rawText],
  );
  const row = result.rows[0];
  if (!row) throw new DomainError("NOT_FOUND", "Import 세션을 찾을 수 없습니다.");
  return toSession(row);
}

// ── 에셋 ──────────────────────────────────────────────────────

type AssetRow = {
  id: string;
  storage_key: string;
  original_filename: string | null;
  mime_type: string;
  byte_size: number;
  sort_order: number;
  uploaded_at: Date | null;
};

function toAsset(row: AssetRow): ImportAssetRecord {
  return {
    id: row.id,
    storageKey: row.storage_key,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    sortOrder: row.sort_order,
    uploadedAt: row.uploaded_at,
  };
}

export async function listAssets(sql: Sql, sessionId: string): Promise<ImportAssetRecord[]> {
  const result = await sql.query<AssetRow>(
    `SELECT id, storage_key, original_filename, mime_type, byte_size, sort_order, uploaded_at
       FROM import_assets WHERE import_session_id = $1 ORDER BY sort_order`,
    [sessionId],
  );
  return result.rows.map(toAsset);
}

/**
 * 에셋 슬롯을 만든다(업로드 전). 같은 sort_order 로 다시 부르면 기존 행을 덮어써
 * 재시도가 중복 행을 만들지 않는다.
 */
export async function upsertAsset(
  sql: Sql,
  input: {
    sessionId: string;
    storageKey: string;
    filename: string;
    mimeType: string;
    byteSize: number;
    order: number;
  },
): Promise<ImportAssetRecord> {
  const result = await sql.query<AssetRow>(
    `INSERT INTO import_assets
       (import_session_id, storage_key, original_filename, mime_type, byte_size, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (import_session_id, sort_order) DO UPDATE
       SET storage_key = EXCLUDED.storage_key,
           original_filename = EXCLUDED.original_filename,
           mime_type = EXCLUDED.mime_type,
           byte_size = EXCLUDED.byte_size,
           uploaded_at = NULL
     RETURNING id, storage_key, original_filename, mime_type, byte_size, sort_order, uploaded_at`,
    [
      input.sessionId,
      input.storageKey,
      input.filename,
      input.mimeType,
      input.byteSize,
      input.order,
    ],
  );
  return toAsset(result.rows[0]!);
}

/**
 * 이미 내려받은 파일을 세션 끝에 붙인다. 슬롯을 미리 만들지 않는 경로
 * (텔레그램처럼 서버가 파일을 직접 가진 경우)가 쓴다.
 *
 * 순서를 `MAX(sort_order) + 1` 로 정하므로 같은 세션에 동시 요청이 들어오면
 * 같은 번호를 잡을 수 있다. 앨범은 여러 webhook 으로 나뉘어 오므로 실제로 일어난다.
 * 그래서 세션 행을 먼저 잠가 직렬화한다 — UNIQUE 위반으로 재시도하는 대신
 * 도착 순서를 그대로 보존한다.
 */
export async function appendUploadedAsset(
  sql: Sql,
  input: {
    sessionId: string;
    storageKey: string;
    filename: string | null;
    mimeType: string;
    byteSize: number;
  },
): Promise<ImportAssetRecord> {
  const locked = await sql.query(`SELECT id FROM import_sessions WHERE id = $1 FOR UPDATE`, [
    input.sessionId,
  ]);
  if (locked.rowCount === 0) {
    throw new DomainError("NOT_FOUND", "Import 세션을 찾을 수 없습니다.");
  }

  const result = await sql.query<AssetRow>(
    `INSERT INTO import_assets
       (import_session_id, storage_key, original_filename, mime_type, byte_size,
        sort_order, uploaded_at)
     SELECT $1, $2, $3, $4, $5, COALESCE(MAX(sort_order) + 1, 0), now()
       FROM import_assets WHERE import_session_id = $1
     RETURNING id, storage_key, original_filename, mime_type, byte_size, sort_order, uploaded_at`,
    [input.sessionId, input.storageKey, input.filename, input.mimeType, input.byteSize],
  );
  return toAsset(result.rows[0]!);
}

export async function markAssetUploaded(sql: Sql, assetId: string): Promise<void> {
  const result = await sql.query(`UPDATE import_assets SET uploaded_at = now() WHERE id = $1`, [
    assetId,
  ]);
  if (result.rowCount === 0) {
    throw new DomainError("NOT_FOUND", "업로드 대상 에셋을 찾을 수 없습니다.");
  }
}

export async function deleteAsset(
  sql: Sql,
  sessionId: string,
  assetId: string,
): Promise<string> {
  const result = await sql.query<{ storage_key: string }>(
    `DELETE FROM import_assets WHERE id = $1 AND import_session_id = $2 RETURNING storage_key`,
    [assetId, sessionId],
  );
  const row = result.rows[0];
  if (!row) throw new DomainError("NOT_FOUND", "에셋을 찾을 수 없습니다.");
  return row.storage_key;
}

// ── 추출 ──────────────────────────────────────────────────────

type ExtractionRow = {
  id: string;
  fields_json: ExtractedFields;
  confidence_json: ExtractionConfidence;
  notes: string[];
  model: string;
  prompt_version: string;
  reviewed_fields_json: Partial<ExtractedFields> | null;
  reviewed_at: Date | null;
  created_at: Date;
};

function toExtraction(row: ExtractionRow): ImportExtractionRecord {
  return {
    id: row.id,
    fields: row.fields_json,
    confidence: row.confidence_json ?? {},
    notes: row.notes ?? [],
    model: row.model,
    promptVersion: row.prompt_version,
    reviewedFields: row.reviewed_fields_json,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

export async function saveExtraction(
  sql: Sql,
  input: {
    sessionId: string;
    fields: ExtractedFields;
    confidence: ExtractionConfidence;
    notes: string[];
    model: string;
    promptVersion: string;
    raw: unknown;
  },
): Promise<ImportExtractionRecord> {
  const result = await sql.query<ExtractionRow>(
    `INSERT INTO import_extractions
       (import_session_id, fields_json, confidence_json, notes, raw_model_output, model, prompt_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, fields_json, confidence_json, notes, model, prompt_version,
               reviewed_fields_json, reviewed_at, created_at`,
    [
      input.sessionId,
      JSON.stringify(input.fields),
      JSON.stringify(input.confidence),
      input.notes,
      JSON.stringify(input.raw),
      input.model,
      input.promptVersion,
    ],
  );
  return toExtraction(result.rows[0]!);
}

export async function latestExtraction(
  sql: Sql,
  sessionId: string,
): Promise<ImportExtractionRecord | null> {
  const result = await sql.query<ExtractionRow>(
    `SELECT id, fields_json, confidence_json, notes, model, prompt_version,
            reviewed_fields_json, reviewed_at, created_at
       FROM import_extractions
      WHERE import_session_id = $1
      ORDER BY created_at DESC LIMIT 1`,
    [sessionId],
  );
  const row = result.rows[0];
  return row ? toExtraction(row) : null;
}

/** 관리자 검토 저장. AI 결과는 그대로 두고 수정본을 따로 남긴다. */
export async function saveReview(
  sql: Sql,
  input: {
    extractionId: string;
    reviewedFields: Partial<ExtractedFields>;
    reviewedBy: string;
  },
): Promise<void> {
  const result = await sql.query(
    `UPDATE import_extractions
        SET reviewed_fields_json = $2, reviewed_by = $3, reviewed_at = now()
      WHERE id = $1`,
    [input.extractionId, JSON.stringify(input.reviewedFields), input.reviewedBy],
  );
  if (result.rowCount === 0) {
    throw new DomainError("NOT_FOUND", "추출 결과를 찾을 수 없습니다.");
  }
}

/** AI 결과 + 관리자 수정본을 합친 최종 값. commit 은 항상 이 값을 쓴다. */
export function effectiveFields(extraction: ImportExtractionRecord | null): ExtractedFields {
  if (!extraction) return emptyExtractedFields();
  return { ...extraction.fields, ...(extraction.reviewedFields ?? {}) };
}

export { statusAfterExtraction, normalizeRawText, assertCommittable, extractedFieldsSchema };
