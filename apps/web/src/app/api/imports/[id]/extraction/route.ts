/** PATCH /api/imports/:id/extraction — 관리자 검토 결과 저장 */
import { DomainError, statusAfterExtraction } from "@bolsaram/domain";
import { updateExtractionSchema } from "@bolsaram/schemas";
import { writeAudit } from "@/server/audit";
import { asAdmin } from "@/server/http/context";
import { ok, readJson, route } from "@/server/http/respond";
import {
  effectiveFields,
  latestExtraction,
  requireSession,
  saveReview,
  setStatus,
} from "@/server/repo/imports";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const PATCH = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const input = await readJson(request, updateExtractionSchema);

  return asAdmin(async (sql, viewer) => {
    const session = await requireSession(sql, id);
    if (session.status === "IMPORTED") {
      throw new DomainError("CONFLICT", "이미 등록된 세션은 수정할 수 없습니다.");
    }
    const extraction = await latestExtraction(sql, id);
    if (!extraction) {
      throw new DomainError("INVALID_STATE", "먼저 분석을 실행해 주세요.");
    }

    const merged = { ...(extraction.reviewedFields ?? {}), ...input.fields };
    await saveReview(sql, {
      extractionId: extraction.id,
      reviewedFields: merged,
      reviewedBy: viewer.userId,
    });

    // 사람이 채운 값을 반영해 다시 판정한다. 사람이 고친 필드는 신뢰도 1로 본다.
    const fields = { ...extraction.fields, ...merged };
    const confidence = { ...extraction.confidence };
    for (const key of Object.keys(merged) as (keyof typeof merged)[]) {
      confidence[key] = 1;
    }
    const next = statusAfterExtraction(fields, confidence);
    if (next !== session.status) await setStatus(sql, id, next);

    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "import.review",
      entityType: "import_session",
      entityId: id,
      metadata: { fields: Object.keys(input.fields), status: next },
    });

    return ok({
      ok: true,
      status: next,
      fields: effectiveFields({ ...extraction, reviewedFields: merged }),
    });
  });
});
