/** POST /api/admin/invites — 초대 링크 발급 */
import { inviteCreateSchema } from "@bolsaram/schemas";
import { writeAudit } from "@/server/audit";
import { requireAdmin, rlsContextOf } from "@/server/auth/guard";
import { issueInvite, inviteUrl } from "@/server/auth/invite";
import { ok, readJson, route } from "@/server/http/respond";
import { withRls } from "@bolsaram/db";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const viewer = await requireAdmin();
  const input = await readJson(request, inviteCreateSchema);

  const invite = await issueInvite({
    profileId: input.profileId,
    expiresInHours: input.expiresInHours,
    createdBy: viewer.userId,
  });

  await withRls(rlsContextOf(viewer), (sql) =>
    writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "invite.issue",
      entityType: "invite",
      entityId: invite.inviteId,
      // 토큰은 남기지 않는다.
      metadata: { profileId: input.profileId, expiresAt: invite.expiresAt.toISOString() },
    }),
  );

  // 평문 토큰은 이 응답에서만 볼 수 있다.
  return ok({ url: inviteUrl(invite.token), expiresAt: invite.expiresAt }, { status: 201 });
});
