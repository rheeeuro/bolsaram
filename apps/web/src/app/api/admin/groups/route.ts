/**
 * 내 모임들.
 *
 *   GET   속한 모임 전부 + 지금 보고 있는 채널 + 기다리는 모임 만들기 요청
 *   POST  모임 만들기 (`MAX_GROUPS_PER_ADMIN` 까지). 관리자가 승인을 켜 두었으면
 *         모임 대신 요청을 남기고 202 로 답한다. 요청은 트리거가 관리자 알림을 남기므로
 *         바로 발송을 띄운다(주기 스윕까지 기다리지 않는다).
 */
import { groupCreateSchema } from "@bolsaram/schemas";
import { requireAdmin } from "@/server/auth/guard";
import { readMyGroupRequests, readMyGroups, requestGroupCreation } from "@/server/auth/group-invite";
import { ok, readJson, route } from "@/server/http/respond";
import { scheduleDispatch } from "@/server/notify/dispatch";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const viewer = await requireAdmin();
  const groups = await readMyGroups(viewer.userId);
  const requests = await readMyGroupRequests(viewer.userId);
  return ok({ groups, activeGroupId: viewer.groupId, requests });
});

export const POST = route(async (request: Request) => {
  const input = await readJson(request, groupCreateSchema);
  const viewer = await requireAdmin();
  const result = await requestGroupCreation({
    userId: viewer.userId,
    isOperator: viewer.isOperator,
    ...input,
  });
  if (result.status === "PENDING") scheduleDispatch();
  return ok(result, { status: result.status === "CREATED" ? 201 : 202 });
});
