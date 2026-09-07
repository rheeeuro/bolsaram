/** GET /api/imports/:id — 원본 + AI 결과 + 검토 상태 */
import { DomainError, reviewFields } from "@bolsaram/domain";
import { asAdmin } from "@/server/http/context";
import { ok, route } from "@/server/http/respond";
import {
  effectiveFields,
  latestExtraction,
  listAssets,
  requireSession,
} from "@/server/repo/imports";
import { signDownloadUrl } from "@/server/storage/local";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  return asAdmin(async (sql) => {
    const session = await requireSession(sql, id);
    const assets = await listAssets(sql, id);
    const extraction = await latestExtraction(sql, id);
    const fields = effectiveFields(extraction);

    return ok({
      session: {
        id: session.id,
        source: session.source,
        status: session.status,
        rawText: session.rawText,
        errorMessage: session.errorMessage,
        committedProfileId: session.committedProfileId,
        createdAt: session.createdAt,
      },
      assets: assets.map((asset) => ({
        id: asset.id,
        order: asset.sortOrder,
        filename: asset.originalFilename,
        uploaded: asset.uploadedAt != null,
        url: asset.uploadedAt ? signDownloadUrl(asset.storageKey) : null,
      })),
      extraction: extraction
        ? {
            id: extraction.id,
            fields,
            aiFields: extraction.fields,
            confidence: extraction.confidence,
            notes: extraction.notes,
            model: extraction.model,
            promptVersion: extraction.promptVersion,
            reviewedAt: extraction.reviewedAt,
            review: reviewFields(fields, extraction.confidence),
          }
        : null,
    });
  });
});

export const DELETE = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  return asAdmin(async (sql) => {
    const session = await requireSession(sql, id);
    if (session.status === "IMPORTED") {
      throw new DomainError("CONFLICT", "이미 등록된 세션은 삭제할 수 없습니다.");
    }
    // 파일은 보관 정책에 따라 별도 정리한다. 여기서는 세션만 지운다.
    await sql.query(`DELETE FROM import_sessions WHERE id = $1`, [id]);
    return ok({ ok: true });
  });
});
