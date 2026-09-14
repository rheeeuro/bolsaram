/**
 * 메시지 지우기.
 *
 * 자기가 쓴 것만 지울 수 있고(RLS), 행은 남기고 본문만 비운다(가드 트리거).
 * 고치는 경로는 만들지 않는다 — 방에 남은 기록이 근거가 되어야 한다.
 */
import { withRls } from "@bolsaram/db";
import { requireGroupAdmin, rlsContextOf } from "@/server/auth/guard";
import { deleteMessage } from "@/server/repo/group-chat";
import { ok, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; messageId: string }> };

export const DELETE = route(async (_request: Request, { params }: Params) => {
  const { id, messageId } = await params;
  const viewer = await requireGroupAdmin(id);
  await withRls(rlsContextOf(viewer), (sql) => deleteMessage(sql, id, messageId));
  return ok({ ok: true });
});
