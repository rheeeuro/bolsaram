/**
 * POST /api/operator/group-requests/:id/approve|reject
 *
 * 관리자가 모임 만들기 요청을 처리한다. 승인하는 순간 모임이 생기고 요청한 주선자가
 * 모임장이 된다. 두 번 눌러도 모임은 하나다 — 요청을 조건부로 닫은 쪽만 만든다.
 */
import { DomainError } from "@bolsaram/domain";
import { uuidSchema } from "@bolsaram/schemas";
import { requireOperator } from "@/server/auth/guard";
import { decideGroupCreationRequest } from "@/server/auth/group-invite";
import { ok, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

const ACTIONS = new Set(["approve", "reject"]);

type Params = { params: Promise<{ id: string; action: string }> };

export const POST = route(async (_request: Request, { params }: Params) => {
  const { id, action } = await params;
  if (!ACTIONS.has(action)) {
    throw new DomainError("VALIDATION", `지원하지 않는 동작입니다: ${action}`);
  }
  const requestId = uuidSchema.parse(id);
  const viewer = await requireOperator();
  const decided = await decideGroupCreationRequest({
    requestId,
    operatorId: viewer.userId,
    approve: action === "approve",
  });
  return ok(decided);
});
