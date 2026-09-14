/**
 * 내 방 상태 — 읽은 위치와 텔레그램 알림.
 *
 *   GET    지금 설정
 *   PATCH  읽음 표시 · 알림 켜고 끄기
 *
 * 모임 단위이고 사람 단위다. 같은 방이라도 알림을 켠 사람에게만 텔레그램이 나간다.
 */
import { withRls } from "@bolsaram/db";
import { groupChatPrefsSchema } from "@bolsaram/schemas";
import { requireGroupAdmin, rlsContextOf } from "@/server/auth/guard";
import { readPrefs, updatePrefs } from "@/server/repo/group-chat";
import { ok, readJson, route } from "@/server/http/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const viewer = await requireGroupAdmin(id);
  const prefs = await withRls(rlsContextOf(viewer), (sql) => readPrefs(sql, id, viewer.userId));
  return ok(prefs);
});

export const PATCH = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const input = await readJson(request, groupChatPrefsSchema);
  const viewer = await requireGroupAdmin(id);
  const prefs = await withRls(rlsContextOf(viewer), (sql) =>
    updatePrefs(sql, id, viewer.userId, input),
  );
  return ok(prefs);
});
