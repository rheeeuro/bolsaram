/**
 * 속한 모임 전부의 안 읽은 개수. 상단 네비 배지가 주기적으로 읽는다.
 *
 * 모임 하나를 지정하지 않으므로 `requireGroupAdmin` 이 아니라 `asAdmin` 이다 —
 * 어느 방이 보이는지는 RLS 가 `group_admins` 로 정한다.
 */
import { asAdmin } from "@/server/http/context";
import { unreadByGroup } from "@/server/repo/group-chat";
import { ok, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const groups = await asAdmin((sql, viewer) => unreadByGroup(sql, viewer.userId));
  return ok({ groups, total: groups.reduce((sum, g) => sum + g.unread, 0) });
});
