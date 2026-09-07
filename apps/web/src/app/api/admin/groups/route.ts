/**
 * POST /api/admin/groups — 모임 만들기
 *
 * 모임에서 제거된 주선자가 다시 시작할 때 쓴다. 가입 경로는 계정과 모임을 함께
 * 만들므로 여기를 지나지 않는다.
 */
import { z } from "zod";
import { requireAdmin } from "@/server/auth/guard";
import { createGroupForAdmin } from "@/server/auth/signup";
import { ok, readJson, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ name: z.string().trim().min(1).max(80) });

export const POST = route(async (request: Request) => {
  const input = await readJson(request, bodySchema);
  // requireAdminGroup 이 아니다 — 모임이 **없는** 주선자를 위한 경로다.
  const viewer = await requireAdmin();
  const created = await createGroupForAdmin({ userId: viewer.userId, name: input.name });
  return ok(created, { status: 201 });
});
