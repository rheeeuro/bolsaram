/** GET /api/profiles/:id — 상세, PATCH — 관리자 수정 */
import { DomainError, isDetailAccessible } from "@bolsaram/domain";
import { profileUpdateSchema } from "@bolsaram/schemas";
import { writeAudit } from "@/server/audit";
import { asAdmin, asUser } from "@/server/http/context";
import { ok, readJson, route } from "@/server/http/respond";
import { isFavorited } from "@/server/repo/favorites";
import { introducedPartnerIds, introducedWithManaged } from "@/server/repo/matches";
import {
  assertCanEditProfile,
  canEditProfiles,
  findProfileById,
  isOutsidePoolForViewer,
  isSameGenderForViewer,
  updateProfile,
} from "@/server/repo/profiles";
import { isMemberView } from "@/server/auth/guard";
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
    // 멤버 화면은 이성만, 그리고 자기 풀 안만 본다. 있는지 없는지도 알리지 않으므로
    // 둘 다 같은 404 다. 풀 경계는 대행 중에만 갈린다 — 그때 RLS 는 주선자 범위다.
    if (
      isMemberView(viewer) &&
      viewer.profileId &&
      profile.userId !== viewer.userId &&
      ((await isSameGenderForViewer(sql, viewer.profileId, profile.gender)) ||
        (await isOutsidePoolForViewer(sql, viewer.profileId, profile.id)))
    ) {
      throw new DomainError("NOT_FOUND", "프로필을 찾을 수 없습니다.");
    }

    // 주선자는 자기 멤버가 낀 연결을, 멤버는 자기 연결을 본다.
    const introducedWith =
      viewer.role === "ADMIN"
        ? await introducedWithManaged(sql)
        : viewer.profileId
          ? await introducedPartnerIds(sql, viewer.profileId)
          : new Set<string>();
    const editable =
      viewer.role === "ADMIN" ? await canEditProfiles(sql, [profile.id]) : new Set<string>();
    const level = disclosureFor({
      profile,
      viewerRole: viewer.role,
      viewerUserId: viewer.userId,
      introducedWith,
      canEdit: editable.has(profile.id),
    });
    const favorited = await isFavorited(sql, viewer.userId, profile.id);
    return ok(toDetailView(profile, level, { isFavorited: favorited }));
  });
});

export const PATCH = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const patch = await readJson(request, profileUpdateSchema);
  return asAdmin(async (sql, viewer) => {
    // RLS 와 별개로 한 번 더 막는다 — 담당이 아니면 조용한 0건이 아니라 이유를 말한다.
    await assertCanEditProfile(sql, id);
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
