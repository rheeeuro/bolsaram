/**
 * 주선자 정지.
 *
 *   PUT     /api/operator/hosts/:id/suspension   정지 (사유는 관리자만 보는 메모)
 *   DELETE  /api/operator/hosts/:id/suspension   정지 풀기
 *
 * 정지하는 순간 세션이 끊기고 등록한 프로필이 비활성이 된다. 풀어도 프로필은 그대로다.
 */
import { hostSuspendSchema, uuidSchema } from "@bolsaram/schemas";
import { requireOperator } from "@/server/auth/guard";
import { suspendHost, unsuspendHost } from "@/server/auth/operator";
import { ok, readJson, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const PUT = route(async (request: Request, { params }: Params) => {
  const userId = uuidSchema.parse((await params).id);
  const input = await readJson(request, hostSuspendSchema);
  const viewer = await requireOperator();
  const result = await suspendHost({ operatorId: viewer.userId, userId, reason: input.reason });
  return ok(result);
});

export const DELETE = route(async (_request: Request, { params }: Params) => {
  const userId = uuidSchema.parse((await params).id);
  const viewer = await requireOperator();
  await unsuspendHost({ operatorId: viewer.userId, userId });
  return ok({ ok: true });
});
