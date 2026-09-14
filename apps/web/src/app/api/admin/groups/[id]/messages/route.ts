/**
 * 모임 채팅방의 메시지.
 *
 *   GET   최근 한 페이지 · `before` 로 거슬러 올라가기
 *   POST  새 메시지
 *
 * 새 글을 받는 것은 스트림(`/api/admin/chat/stream`)이다. 여기로 묻지 않는다.
 *
 * 이 방은 주선자 전용이다. `requireGroupAdmin` 으로 소속을 확인하고, 그와 별개로
 * RLS 가 같은 판정을 다시 한다(`app_is_group_admin`).
 */
import { groupMessageCreateSchema, groupMessageQuerySchema } from "@bolsaram/schemas";
import { requireGroupAdmin, rlsContextOf } from "@/server/auth/guard";
import { withRls } from "@bolsaram/db";
import { createMessage, listMessages } from "@/server/repo/group-chat";
import { scheduleDispatch } from "@/server/notify/dispatch";
import { ok, readJson, readQuery, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const query = readQuery(request, groupMessageQuerySchema);
  const viewer = await requireGroupAdmin(id);
  const messages = await withRls(rlsContextOf(viewer), (sql) => listMessages(sql, id, query));
  return ok({ messages });
});

export const POST = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const input = await readJson(request, groupMessageCreateSchema);
  const viewer = await requireGroupAdmin(id);
  const message = await withRls(rlsContextOf(viewer), (sql) =>
    createMessage(sql, id, viewer.userId, input.body),
  );
  // 알림을 켜 둔 동료가 있으면 DB 트리거가 아웃박스에 남겨 두었다. 응답을 막지 않는다.
  scheduleDispatch();
  return ok({ message }, { status: 201 });
});
