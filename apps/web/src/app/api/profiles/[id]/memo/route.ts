/** PUT /api/profiles/:id/memo — 주선자 메모 저장 (등록한 주선자만, 빈 글이면 삭제) */
import { profileMemoUpdateSchema } from "@bolsaram/schemas";
import { writeAudit } from "@/server/audit";
import { asAdmin } from "@/server/http/context";
import { ok, readJson, route } from "@/server/http/respond";
import { assertCanEditProfile, saveProfileMemo } from "@/server/repo/profiles";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const PUT = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const input = await readJson(request, profileMemoUpdateSchema);
  return asAdmin(async (sql, viewer) => {
    // RLS 만 믿으면 남의 프로필에는 조용히 0건이 된다. 이유를 말하도록 먼저 막는다.
    await assertCanEditProfile(sql, id);
    const memo = await saveProfileMemo(sql, id, input.body);
    // 메모 내용은 감사 기록에 남기지 않는다 — 남기면 메모를 못 보는 사람이 읽는 통로가 된다.
    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "profile.memo",
      entityType: "profile",
      entityId: id,
      metadata: { cleared: memo === null },
    });
    return ok({ memo });
  });
});
