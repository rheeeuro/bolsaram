/** POST /api/imports/:id/analyze — AI 추출 실행 */
import { requireAdmin, rlsContextOf } from "@/server/auth/guard";
import { ok, route } from "@/server/http/respond";
import { analyzeSession } from "@/server/services/import-service";

export const dynamic = "force-dynamic";
// 이미지가 많으면 모델 호출이 길어질 수 있다.
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

export const POST = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const viewer = await requireAdmin();
  const result = await analyzeSession(rlsContextOf(viewer), id);
  return ok(result);
});
