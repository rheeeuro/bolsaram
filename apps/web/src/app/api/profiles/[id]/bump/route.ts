/** POST /api/profiles/:id/bump — 목록 맨 앞으로 끌어올리기 (등록한 주선자만, 24시간에 한 번) */
import { writeAudit } from "@/server/audit";
import { asAdmin } from "@/server/http/context";
import { ok, route } from "@/server/http/respond";
import { assertCanEditProfile, bumpProfile } from "@/server/repo/profiles";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const POST = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  return asAdmin(async (sql, viewer) => {
    // RLS 만 믿으면 남의 프로필에는 조용히 0건이 된다. 이유를 말하도록 먼저 막는다.
    await assertCanEditProfile(sql, id);
    const bumpedAt = await bumpProfile(sql, id);
    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "profile.bump",
      entityType: "profile",
      entityId: id,
    });
    return ok({ bumpedAt: bumpedAt.toISOString() });
  });
});
