/**
 * Import 파이프라인의 조립부.
 *   analyze — 원문/이미지를 프로바이더에 넘기고 결과를 저장, 상태를 검토 단계로 옮긴다.
 *   commit  — 검토가 끝난 값으로 Profile 을 만들거나 갱신한다. idempotent 해야 한다.
 */
import "server-only";
import { withRls, type RlsContext, type Sql } from "@bolsaram/db";
import {
  DomainError,
  assertCommittable,
  normalizeRawText,
  statusAfterExtraction,
} from "@bolsaram/domain";
import type { ExtractedFields } from "@bolsaram/schemas";
import { extractionProvider } from "../ai/index";
import { writeAudit } from "../audit";
import * as imports from "../repo/imports";
import { objectSize, openObject } from "../storage/local";

/** 분석에 넣을 이미지 최대 장수. 나머지는 사람이 보고 판단한다. */
const MAX_ANALYZE_IMAGES = 6;
const MAX_ANALYZE_IMAGE_BYTES = 8 * 1024 * 1024;

async function readAsset(storageKey: string): Promise<Buffer | null> {
  const size = await objectSize(storageKey);
  if (size == null || size > MAX_ANALYZE_IMAGE_BYTES) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of openObject(storageKey)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * 분석 실행. 실패하면 세션을 FAILED 로 남기고 예외를 올린다 — 삼키지 않는다.
 * 프로바이더 호출이 길 수 있어 RLS 트랜잭션 밖에서 수행하고, 앞뒤로만 DB 를 만진다.
 */
export async function analyzeSession(
  ctx: RlsContext,
  sessionId: string,
): Promise<{ status: "READY" | "REVIEW_REQUIRED" }> {
  const prepared = await withRls(ctx, async (sql) => {
    const session = await imports.requireSession(sql, sessionId);
    if (session.status === "IMPORTED") {
      throw new DomainError("CONFLICT", "이미 등록된 세션입니다.");
    }
    const assets = await imports.listAssets(sql, sessionId);
    const uploaded = assets.filter((a) => a.uploadedAt != null);

    if (!session.rawText?.trim() && uploaded.length === 0) {
      throw new DomainError(
        "VALIDATION",
        "분석할 내용이 없습니다. 사진을 올리거나 카카오톡에서 복사한 글을 붙여넣어 주세요.",
      );
    }
    await imports.setStatus(sql, sessionId, "ANALYZING");
    return { rawText: session.rawText, assets: uploaded.slice(0, MAX_ANALYZE_IMAGES) };
  });

  try {
    const images: { mimeType: string; data: Buffer }[] = [];
    for (const asset of prepared.assets) {
      const data = await readAsset(asset.storageKey);
      if (data) images.push({ mimeType: asset.mimeType, data });
    }

    const result = await extractionProvider().extract({
      text: prepared.rawText ? normalizeRawText(prepared.rawText) : null,
      images,
    });

    return await withRls(ctx, async (sql) => {
      await imports.saveExtraction(sql, {
        sessionId,
        fields: result.fields,
        confidence: result.confidence,
        notes: result.notes,
        model: result.model,
        promptVersion: result.promptVersion,
        raw: result.raw,
      });
      // AI 결과는 자동 게시하지 않는다. 항상 사람 검토 단계로 넘어간다.
      const next = statusAfterExtraction(result.fields, result.confidence);
      await imports.setStatus(sql, sessionId, next);
      await writeAudit(sql, {
        actorUserId: ctx.userId,
        action: "import.analyze",
        entityType: "import_session",
        entityId: sessionId,
        metadata: { model: result.model, promptVersion: result.promptVersion, status: next },
      });
      return { status: next };
    });
  } catch (error) {
    // 실패 상태를 남겨 재시도 가능하게 한 뒤 원본 오류를 다시 던진다.
    await withRls(ctx, (sql) =>
      imports.setStatus(sql, sessionId, "FAILED", messageOf(error)),
    ).catch((secondary: unknown) => {
      console.error("Import 실패 상태 기록에도 실패", secondary);
    });
    throw error;
  }
}

function messageOf(error: unknown): string {
  if (error instanceof DomainError) return error.message;
  return "분석 중 알 수 없는 오류가 발생했습니다.";
}

export type CommitResult = {
  profileId: string;
  /** 이미 커밋된 세션을 다시 호출한 경우 true. 새 프로필을 만들지 않았다. */
  reused: boolean;
};

/**
 * 검토 완료된 값으로 프로필을 만든다.
 *
 * idempotency:
 *   1) 세션에 committed_profile_id 가 있으면 그대로 돌려준다.
 *   2) 없으면 idempotency_key 를 조건부로 선점한다(`WHERE idempotency_key IS NULL`).
 *      경쟁에서 진 요청은 다시 읽어 1)로 떨어진다.
 */
export async function commitSession(
  ctx: RlsContext,
  input: {
    sessionId: string;
    idempotencyKey: string;
    targetProfileId?: string;
    publish: boolean;
  },
): Promise<CommitResult> {
  return withRls(ctx, async (sql) => {
    const session = await imports.requireSession(sql, input.sessionId);
    if (session.committedProfileId) {
      return { profileId: session.committedProfileId, reused: true };
    }

    const extraction = await imports.latestExtraction(sql, input.sessionId);
    const fields = imports.effectiveFields(extraction);
    assertCommittable(session.status, fields, { publish: input.publish });

    // 키를 먼저 선점한다. 같은 세션에 동시 commit 이 들어오면 하나만 통과한다.
    const claim = await sql.query<{ id: string }>(
      `UPDATE import_sessions SET idempotency_key = $2
        WHERE id = $1 AND idempotency_key IS NULL
        RETURNING id`,
      [input.sessionId, input.idempotencyKey],
    );
    if (claim.rowCount === 0) {
      const again = await imports.requireSession(sql, input.sessionId);
      if (again.committedProfileId) {
        return { profileId: again.committedProfileId, reused: true };
      }
      throw new DomainError("CONFLICT", "다른 요청이 등록을 진행 중입니다.");
    }

    const profileId = input.targetProfileId
      ? await updateExistingProfile(sql, input.targetProfileId, fields)
      : await insertProfile(sql, fields, ctx.userId, input.publish);

    await moveImagesToProfile(sql, input.sessionId, profileId);

    await sql.query(
      `UPDATE import_sessions
          SET status = 'IMPORTED', committed_profile_id = $2, committed_at = now()
        WHERE id = $1`,
      [input.sessionId, profileId],
    );

    await writeAudit(sql, {
      actorUserId: ctx.userId,
      action: "import.commit",
      entityType: "profile",
      entityId: profileId,
      metadata: { sessionId: input.sessionId, published: input.publish },
    });

    return { profileId, reused: false };
  });
}

async function insertProfile(
  sql: Sql,
  fields: ExtractedFields,
  createdBy: string | null,
  publish: boolean,
): Promise<string> {
  // assertCommittable 이 필수 필드를 이미 확인했다.
  const result = await sql.query<{ id: string }>(
    `INSERT INTO profiles (
       gender, birth_year, height, job_title, job_category, company, education,
       residence_region, workplace_region, religion, mbti, smoking, drinking,
       hobbies, bio, ideal_type_text, status, visibility, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING id`,
    [
      fields.gender,
      fields.birthYear,
      fields.height,
      fields.jobTitle,
      fields.jobCategory,
      fields.company,
      fields.education,
      fields.residenceRegion,
      fields.workplaceRegion,
      fields.religion,
      fields.mbti,
      fields.smoking,
      fields.drinking,
      fields.hobbies ?? [],
      fields.bio,
      fields.idealTypeText,
      publish ? "ACTIVE" : "INACTIVE",
      publish ? "LISTED" : "PRIVATE",
      createdBy,
    ],
  );
  return result.rows[0]!.id;
}

async function updateExistingProfile(
  sql: Sql,
  profileId: string,
  fields: ExtractedFields,
): Promise<string> {
  // null 인 필드는 기존 값을 지우지 않는다 — 재분석이 정보를 잃게 하면 안 된다.
  const result = await sql.query<{ id: string }>(
    `UPDATE profiles SET
       gender = COALESCE($2, gender),
       birth_year = COALESCE($3, birth_year),
       height = COALESCE($4, height),
       job_title = COALESCE($5, job_title),
       job_category = COALESCE($6, job_category),
       company = COALESCE($7, company),
       education = COALESCE($8, education),
       residence_region = COALESCE($9, residence_region),
       workplace_region = COALESCE($10, workplace_region),
       religion = COALESCE($11, religion),
       mbti = COALESCE($12, mbti),
       smoking = COALESCE($13, smoking),
       drinking = COALESCE($14, drinking),
       hobbies = CASE WHEN cardinality($15::text[]) > 0 THEN $15::text[] ELSE hobbies END,
       bio = COALESCE($16, bio),
       ideal_type_text = COALESCE($17, ideal_type_text)
     WHERE id = $1 RETURNING id`,
    [
      profileId,
      fields.gender,
      fields.birthYear,
      fields.height,
      fields.jobTitle,
      fields.jobCategory,
      fields.company,
      fields.education,
      fields.residenceRegion,
      fields.workplaceRegion,
      fields.religion,
      fields.mbti,
      fields.smoking,
      fields.drinking,
      fields.hobbies ?? [],
      fields.bio,
      fields.idealTypeText,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new DomainError("NOT_FOUND", "대상 프로필을 찾을 수 없습니다.");
  return row.id;
}

/**
 * Import 에셋을 프로필 사진으로 연결한다.
 * 파일은 그대로 두고 참조만 추가한다 — 원본 보관/삭제 정책은 별도로 다룬다.
 */
async function moveImagesToProfile(
  sql: Sql,
  sessionId: string,
  profileId: string,
): Promise<void> {
  const assets = await imports.listAssets(sql, sessionId);
  const uploaded = assets.filter(
    (a) => a.uploadedAt != null && a.mimeType.startsWith("image/"),
  );
  if (uploaded.length === 0) return;

  const existing = await sql.query<{ max: number | null }>(
    `SELECT max(sort_order) AS max FROM profile_images WHERE profile_id = $1`,
    [profileId],
  );
  let order = (existing.rows[0]?.max ?? -1) + 1;
  const hasPrimary = await sql.query(
    `SELECT 1 FROM profile_images WHERE profile_id = $1 AND is_primary`,
    [profileId],
  );
  let needsPrimary = (hasPrimary.rowCount ?? 0) === 0;

  for (const asset of uploaded) {
    await sql.query(
      `INSERT INTO profile_images
         (profile_id, storage_key, mime_type, byte_size, sort_order, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (profile_id, sort_order) DO NOTHING`,
      [profileId, asset.storageKey, asset.mimeType, asset.byteSize, order, needsPrimary],
    );
    needsPrimary = false;
    order += 1;
  }
}
