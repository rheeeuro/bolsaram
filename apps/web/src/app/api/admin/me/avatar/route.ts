/**
 * POST   /api/admin/me/avatar — 내 프로필 사진 올리기 (슬롯 요청 → 확정)
 * DELETE /api/admin/me/avatar — 내 프로필 사진 지우기
 *
 * 처음 사진은 카카오·구글이 준 것으로 시작하지만(`server/auth/oauth.ts`) 그 뒤로는
 * 본인이 정한다 — 표시 이름과 같은 규칙이다.
 *
 * 프로필 사진(`/api/profiles/:id/images`)과 같은 두 단계다. 슬롯 단계에서 서버가 키를
 * 정하므로 클라이언트가 경로를 고를 수 없고, 확정 단계에서 그 키가 **내 것인지** 다시
 * 본다. 사진이 없는 상태가 정상이라 지우는 것도 평범한 동작이다 — 화면은 앞글자를 그린다.
 */
import { imageUploadSchema } from "@bolsaram/schemas";
import { DomainError } from "@bolsaram/domain";
import { writeAudit } from "@/server/audit";
import { asAdmin } from "@/server/http/context";
import { fail, ok, readJson, route } from "@/server/http/respond";
import { updateAvatarKey } from "@/server/repo/users";
import {
  MAX_IMAGE_BYTES,
  buildStorageKey,
  deleteObject,
  isAllowedImageType,
  objectSize,
  signUploadToken,
} from "@/server/storage/local";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const body = await readJson(request, imageUploadSchema);

  return asAdmin(async (sql, viewer) => {
    if ("confirm" in body) {
      // 남의 키를 붙여 넣지 못하게 한다. 키는 슬롯 단계에서 서버가 준 것뿐이다.
      if (!body.confirm.key.startsWith(`avatar/${viewer.userId}/`)) {
        throw new DomainError("VALIDATION", "내 업로드가 아닙니다.");
      }
      // 실제로 올라간 뒤에만 계정에 붙인다.
      if ((await objectSize(body.confirm.key)) == null) {
        throw new DomainError(
          "INVALID_STATE",
          "업로드된 파일을 찾을 수 없습니다. 다시 올려주세요.",
        );
      }

      const { previousKey } = await updateAvatarKey(sql, viewer.userId, body.confirm.key);
      await writeAudit(sql, {
        actorUserId: viewer.userId,
        action: "user.avatar.set",
        entityType: "user",
        entityId: viewer.userId,
        // 스토리지 키는 남기지 않는다.
      });
      // 밀려난 사진은 아무도 가리키지 않는다. 실패해도 화면은 이미 맞다.
      if (previousKey) await deleteObject(previousKey);
      return ok({ ok: true });
    }

    if (!isAllowedImageType(body.mimeType)) {
      return fail("VALIDATION", "지원하지 않는 이미지 형식입니다.", 415);
    }
    if (body.size > MAX_IMAGE_BYTES) {
      return fail("VALIDATION", "파일이 너무 큽니다(최대 25MB).", 413);
    }

    const key = buildStorageKey("avatar", viewer.userId, body.mimeType);
    return ok({
      key,
      uploadUrl: `/api/uploads?key=${encodeURIComponent(key)}&token=${signUploadToken(key)}`,
    });
  });
});

export const DELETE = route(async () => {
  return asAdmin(async (sql, viewer) => {
    const { previousKey } = await updateAvatarKey(sql, viewer.userId, null);
    if (!previousKey) return ok({ ok: true });

    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "user.avatar.clear",
      entityType: "user",
      entityId: viewer.userId,
    });
    await deleteObject(previousKey);
    return ok({ ok: true });
  });
});
