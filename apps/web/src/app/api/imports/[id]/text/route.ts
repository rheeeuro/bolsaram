/** PATCH /api/imports/:id/text — 카카오톡에서 복사한 원문 저장 (fallback 경로) */
import { updateImportTextSchema } from "@bolsaram/schemas";
import { asAdmin } from "@/server/http/context";
import { ok, readJson, route } from "@/server/http/respond";
import { updateRawText } from "@/server/repo/imports";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const PATCH = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const input = await readJson(request, updateImportTextSchema);
  return asAdmin(async (sql) => {
    // 원문은 그대로 보관한다. 정규화는 분석 직전에만 적용한다.
    const session = await updateRawText(sql, id, input.rawText);
    return ok({ ok: true, status: session.status });
  });
});
