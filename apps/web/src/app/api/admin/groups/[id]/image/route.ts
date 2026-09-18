/**
 * POST   /api/admin/groups/:id/image — 모임 사진 올리기 (슬롯 요청 → 확정)
 * DELETE /api/admin/groups/:id/image — 모임 사진 지우기
 *
 * 이름·설명과 같은 취급이다 — 그 모임의 주선자면 누구나 바꾼다. 인증 레이어(owner
 * 커넥션)로 돌기 때문에 RLS 가 걸리지 않고, `requireGroupAdmin` 이 유일한 소속 확인이다.
 *
 * 올리는 방식은 다른 사진과 같다. 슬롯 단계에서 서버가 키를 정하고, 확정 단계에서 그
 * 키가 **이 모임의 것인지** 다시 본다. 사진이 없으면 화면은 모임 이름의 앞글자를 그린다.
 */
import { imageUploadSchema } from "@bolsaram/schemas";
import { DomainError } from "@bolsaram/domain";
import { requireGroupAdmin } from "@/server/auth/guard";
import { updateGroupImage } from "@/server/auth/group-invite";
import { fail, ok, readJson, route } from "@/server/http/respond";
import {
  MAX_IMAGE_BYTES,
  buildStorageKey,
  deleteObject,
  isAllowedImageType,
  objectSize,
  signUploadToken,
} from "@/server/storage/local";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const POST = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const body = await readJson(request, imageUploadSchema);
  await requireGroupAdmin(id);

  if ("confirm" in body) {
    if (!body.confirm.key.startsWith(`group/${id}/`)) {
      throw new DomainError("VALIDATION", "이 모임의 업로드가 아닙니다.");
    }
    if ((await objectSize(body.confirm.key)) == null) {
      throw new DomainError("INVALID_STATE", "업로드된 파일을 찾을 수 없습니다. 다시 올려주세요.");
    }

    const { previousKey } = await updateGroupImage({ groupId: id, imageKey: body.confirm.key });
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

  const key = buildStorageKey("group", id, body.mimeType);
  return ok({
    key,
    uploadUrl: `/api/uploads?key=${encodeURIComponent(key)}&token=${signUploadToken(key)}`,
  });
});

export const DELETE = route(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  await requireGroupAdmin(id);

  const { previousKey } = await updateGroupImage({ groupId: id, imageKey: null });
  if (previousKey) await deleteObject(previousKey);
  return ok({ ok: true });
});
