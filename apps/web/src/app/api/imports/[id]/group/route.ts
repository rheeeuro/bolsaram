/**
 * PATCH /api/imports/:id/group — 등록될 모임(방) 바꾸기
 *
 * 세션은 만들 때 보고 있던 모임으로 들어간다. 텔레그램으로 사진을 보낼 때는 웹에서
 * 어느 방을 보고 있었는지가 그대로 정해지므로, 검토하다가 방을 잘못 골랐다는 것을
 * 알게 되는 경우가 있다. 다시 보내게 하지 않고 여기서 옮긴다.
 *
 * 권한은 두 겹이다 — `assertGroupAdmin` 이 옮겨 갈 모임의 소속을 확인하고,
 * RLS 가 지금 모임의 세션인지와 옮겨 갈 모임의 주선자인지를 다시 본다.
 * 전체공개(`null`)로 되돌리는 것은 정책상 세션을 만든 사람만 할 수 있다.
 */
import { updateImportGroupSchema } from "@bolsaram/schemas";
import { assertGroupAdmin } from "@/server/auth/group-invite";
import { writeAudit } from "@/server/audit";
import { asAdmin } from "@/server/http/context";
import { ok, readJson, route } from "@/server/http/respond";
import { setSessionGroup } from "@/server/repo/imports";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const PATCH = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const input = await readJson(request, updateImportGroupSchema);
  return asAdmin(async (sql, viewer) => {
    if (input.groupId) await assertGroupAdmin(viewer.userId, input.groupId);
    const session = await setSessionGroup(sql, id, input.groupId);
    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "import.move",
      entityType: "import_session",
      entityId: id,
      metadata: { groupId: session.groupId },
    });
    return ok({ groupId: session.groupId });
  });
});
