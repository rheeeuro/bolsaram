/**
 * PATCH  /api/profiles/:id/images/:imageId — 대표 사진 지정
 * DELETE /api/profiles/:id/images/:imageId — 사진 삭제
 *
 * 대표가 없는 상태나 대표가 둘인 상태를 만들지 않는 것은 저장소가 지킨다.
 */
import { profileImagePatchSchema } from "@bolsaram/schemas";
import { writeAudit } from "@/server/audit";
import { asAdmin } from "@/server/http/context";
import { ok, readJson, route } from "@/server/http/respond";
import { assertCanEditProfile } from "@/server/repo/profiles";
import { deleteImage, setPrimaryImage } from "@/server/repo/profile-images";
import { deleteObject } from "@/server/storage/local";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; imageId: string }> };

export const PATCH = route(async (request: Request, { params }: Params) => {
  const { id, imageId } = await params;
  await readJson(request, profileImagePatchSchema);

  return asAdmin(async (sql, viewer) => {
    await assertCanEditProfile(sql, id);
    await setPrimaryImage(sql, { profileId: id, imageId });
    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "profile.image.primary",
      entityType: "profile",
      entityId: id,
      metadata: { imageId },
    });
    return ok({ ok: true });
  });
});

export const DELETE = route(async (_request: Request, { params }: Params) => {
  const { id, imageId } = await params;

  return asAdmin(async (sql, viewer) => {
    await assertCanEditProfile(sql, id);
    const { storageKey } = await deleteImage(sql, { profileId: id, imageId });
    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "profile.image.delete",
      entityType: "profile",
      entityId: id,
      metadata: { imageId },
    });
    // 행이 사라진 뒤에 파일을 지운다. 파일 삭제가 실패해도 화면은 이미 맞다.
    await deleteObject(storageKey);
    return ok({ ok: true });
  });
});
