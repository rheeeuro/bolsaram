/**
 * 관리자 설정.
 *
 *   GET  지금 설정
 *   PUT  모임 만들기 승인 켜기·끄기
 *
 * 끄더라도 이미 들어온 요청은 남는다 — 관리자가 승인하거나 거절해야 닫힌다.
 */
import { operatorSettingsUpdateSchema } from "@bolsaram/schemas";
import { requireOperator } from "@/server/auth/guard";
import { readOperatorSettings, setGroupCreationApproval } from "@/server/auth/operator";
import { ok, readJson, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireOperator();
  return ok(await readOperatorSettings());
});

export const PUT = route(async (request: Request) => {
  const input = await readJson(request, operatorSettingsUpdateSchema);
  const viewer = await requireOperator();
  const settings = await setGroupCreationApproval({
    operatorId: viewer.userId,
    enabled: input.groupCreationRequiresApproval,
  });
  return ok(settings);
});
