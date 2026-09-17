/** PATCH /api/imports/:id/extraction — 관리자 검토 결과 저장 */
import { updateExtractionSchema } from "@bolsaram/schemas";
import { asAdmin } from "@/server/http/context";
import { ok, readJson, route } from "@/server/http/respond";
import { applyExtractionReview } from "@/server/services/import-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const PATCH = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const input = await readJson(request, updateExtractionSchema);

  return asAdmin(async (sql, viewer) => {
    // 저장·재판정·감사 기록은 봇 버튼과 같은 서비스가 한다.
    const result = await applyExtractionReview(sql, {
      sessionId: id,
      fields: input.fields,
      reviewerUserId: viewer.userId,
      source: "web",
    });
    return ok({ ok: true, status: result.status, fields: result.fields });
  });
});
