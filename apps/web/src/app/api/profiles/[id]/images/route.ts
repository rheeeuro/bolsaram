/**
 * POST /api/profiles/:id/images — 사진 추가 (슬롯 요청 → 확정)
 *
 * 사진은 Import 로 처음 들어오지만 그 뒤에도 바뀐다. 대면에서 「이 사진 말고 다른
 * 걸로」가 나오는데 지금까지는 고칠 방법이 없었다.
 *
 * Import 와 같은 두 단계다. 다만 여기서는 **확정할 때만 DB 행을 만든다** —
 * 미리 만들어 두면 업로드가 실패했을 때 깨진 사진이 프로필에 남는다. 대신 확정되지
 * 않은 파일이 스토리지에 남을 수 있고, 그건 정리 작업이 걷어간다.
 */
import { z } from "zod";
import { profileImageConfirmSchema, profileImageSlotSchema } from "@bolsaram/schemas";
import { DomainError } from "@bolsaram/domain";
import { writeAudit } from "@/server/audit";
import { asAdmin } from "@/server/http/context";
import { fail, ok, readJson, route } from "@/server/http/respond";
import { assertCanEditProfile } from "@/server/repo/profiles";
import { addImage } from "@/server/repo/profile-images";
import {
  MAX_IMAGE_BYTES,
  buildStorageKey,
  isAllowedImageType,
  objectSize,
  signUploadToken,
} from "@/server/storage/local";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.union([profileImageConfirmSchema, profileImageSlotSchema]);

export const POST = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const body = await readJson(request, bodySchema);

  return asAdmin(async (sql, viewer) => {
    // RLS 와 별개로 한 번 더 막는다 — 스토리지 키를 발급하는 경로라 더 그렇다.
    await assertCanEditProfile(sql, id);

    if ("confirm" in body) {
      // 키가 이 프로필의 것인지 확인한다. 남의 키를 붙여 넣지 못하게 한다.
      const expectedPrefix = `profile/${id}/`;
      if (!body.confirm.key.startsWith(expectedPrefix)) {
        throw new DomainError("VALIDATION", "이 프로필의 업로드가 아닙니다.");
      }
      // 실제로 파일이 있는지 본 뒤에만 행을 만든다.
      const size = await objectSize(body.confirm.key);
      if (size == null) {
        throw new DomainError(
          "INVALID_STATE",
          "업로드된 파일을 찾을 수 없습니다. 다시 올려주세요.",
        );
      }
      const image = await addImage(sql, {
        profileId: id,
        storageKey: body.confirm.key,
        mimeType: body.confirm.mimeType,
        byteSize: size,
      });
      await writeAudit(sql, {
        actorUserId: viewer.userId,
        action: "profile.image.add",
        entityType: "profile",
        entityId: id,
        // 스토리지 키는 남기지 않는다.
        metadata: { imageId: image.id },
      });
      return ok({ ok: true, imageId: image.id, isPrimary: image.isPrimary });
    }

    if (!isAllowedImageType(body.mimeType)) {
      return fail("VALIDATION", "지원하지 않는 이미지 형식입니다.", 415);
    }
    if (body.size > MAX_IMAGE_BYTES) {
      return fail("VALIDATION", "파일이 너무 큽니다(최대 25MB).", 413);
    }

    // 경로는 서버가 정한다. 클라이언트가 키를 고르지 못한다.
    const key = buildStorageKey("profile", id, body.mimeType);
    return ok({
      key,
      uploadUrl: `/api/uploads?key=${encodeURIComponent(key)}&token=${signUploadToken(key)}`,
    });
  });
});
