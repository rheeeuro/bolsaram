/**
 * 내 모임 관리.
 *
 *   GET    내 모임과 주선자 목록
 *   PATCH  모임 이름·설명 수정 (모임에 속한 주선자만)
 *   POST   초대 코드 발급 (모임에 속한 주선자만)
 *   PUT    초대 코드로 합류 (모임이 없는 주선자만)
 *   DELETE 모임 나가기
 *
 * 평문 코드는 발급 응답에 한 번만 실린다. 다시 조회할 수 없고 로그에 남기지 않는다.
 */
import { z } from "zod";
import { requireAdmin, requireAdminGroup } from "@/server/auth/guard";
import { groupUpdateSchema } from "@bolsaram/schemas";
import {
  consumeGroupInvite,
  issueGroupInvite,
  leaveGroup,
  readMyGroup,
  updateGroup,
} from "@/server/auth/group-invite";
import { ok, readJson, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const viewer = await requireAdmin();
  const group = await readMyGroup(viewer.userId);
  return ok({ group });
});

export const PATCH = route(async (request: Request) => {
  const input = await readJson(request, groupUpdateSchema);
  const viewer = await requireAdminGroup();
  await updateGroup({ groupId: viewer.groupId, ...input });
  return ok({ ok: true });
});

export const POST = route(async () => {
  const viewer = await requireAdminGroup();
  const issued = await issueGroupInvite({
    groupId: viewer.groupId,
    createdBy: viewer.userId,
  });
  return ok({ code: issued.code, expiresAt: issued.expiresAt }, { status: 201 });
});

export const PUT = route(async (request: Request) => {
  const input = await readJson(request, z.object({ code: z.string().trim().min(8).max(200) }));
  // requireAdminGroup 이 아니다 — 모임이 **없는** 주선자가 합류하는 경로다.
  const viewer = await requireAdmin();
  const joined = await consumeGroupInvite({ code: input.code, userId: viewer.userId });
  return ok(joined);
});

export const DELETE = route(async () => {
  const viewer = await requireAdminGroup();
  const result = await leaveGroup(viewer.userId);
  return ok(result);
});
