/** GET /api/profiles/:id — 상세, PATCH — 관리자 수정 */
import { DomainError, isDetailAccessible } from "@bolsaram/domain";
import { profileUpdateSchema } from "@bolsaram/schemas";
import { writeAudit } from "@/server/audit";
import { asAdmin, asUser } from "@/server/http/context";
import { ok, readJson, route } from "@/server/http/respond";
import { isFavorited } from "@/server/repo/favorites";
import { introducedPartnerIds } from "@/server/repo/matches";
import { findProfileById, updateProfile } from "@/server/repo/profiles";
import { disclosureFor, toDetailView } from "@/server/views/profile-view";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  return asUser(async (sql, viewer) => {
    const profile = await findProfileById(sql, id);
    // RLS 가 이미 걸러내지만 상태 기반 접근 규칙을 한 번 더 확인한다.
    if (!profile) throw new DomainError("NOT_FOUND", "프로필을 찾을 수 없습니다.");
    if (
      viewer.role !== "ADMIN" &&
      profile.userId !== viewer.userId &&
      !isDetailAccessible(profile)
    ) {
      throw new DomainError("NOT_FOUND", "프로필을 찾을 수 없습니다.");
    }

    const introducedWith = viewer.profileId
      ? await introducedPartnerIds(sql, viewer.profileId)
      : new Set<string>();
    const level = disclosureFor({
      profile,
      viewerRole: viewer.role,
      viewerUserId: viewer.userId,
      introducedWith,
    });
    const favorited = await isFavorited(sql, viewer.userId, profile.id);
    return ok(toDetailView(profile, level, { isFavorited: favorited }));
  });
});

export const PATCH = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const patch = await readJson(request, profileUpdateSchema);
  return asAdmin(async (sql, viewer) => {
    const updated = await updateProfile(sql, id, patch);
    if (!updated) throw new DomainError("NOT_FOUND", "프로필을 찾을 수 없습니다.");
    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "profile.update",
      entityType: "profile",
      entityId: id,
      // 값이 아니라 어떤 필드를 건드렸는지만 남긴다.
      metadata: { fields: Object.keys(patch) },
    });
    return ok({ ok: true });
  });
});
