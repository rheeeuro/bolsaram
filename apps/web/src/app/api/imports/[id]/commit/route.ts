/** POST /api/imports/:id/commit — 검토 완료 값으로 프로필 생성/갱신 (idempotent) */
import { commitImportSchema } from "@bolsaram/schemas";
import { requireAdmin, rlsContextOf } from "@/server/auth/guard";
import { ok, readJson, route } from "@/server/http/respond";
import { commitSession } from "@/server/services/import-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const POST = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const input = await readJson(request, commitImportSchema);
  const viewer = await requireAdmin();

  const result = await commitSession(rlsContextOf(viewer), {
    sessionId: id,
    idempotencyKey: input.idempotencyKey,
    ...(input.targetProfileId ? { targetProfileId: input.targetProfileId } : {}),
    publish: input.publish,
  });
  // 같은 키로 다시 호출하면 200 + reused:true 로 같은 프로필을 돌려준다.
  return ok(result, { status: result.reused ? 200 : 201 });
});
