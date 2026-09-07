/**
 * POST   /api/imports/:id/assets — 업로드 확정 또는 슬롯 추가
 * DELETE /api/imports/:id/assets — 에셋 제거
 */
import { z } from "zod";
import { DomainError } from "@bolsaram/domain";
import { registerImportAssetSchema } from "@bolsaram/schemas";
import { asAdmin } from "@/server/http/context";
import { fail, ok, readJson, route } from "@/server/http/respond";
import {
  deleteAsset,
  listAssets,
  markAssetUploaded,
  requireSession,
  upsertAsset,
} from "@/server/repo/imports";
import {
  buildStorageKey,
  deleteObject,
  isAllowedImageType,
  objectSize,
  signUploadToken,
} from "@/server/storage/local";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 업로드를 마쳤다고 알리거나(confirm), 새 슬롯을 요청한다(register). */
const bodySchema = z.union([z.object({ confirm: z.uuid() }), registerImportAssetSchema]);

export const POST = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const body = await readJson(request, bodySchema);

  return asAdmin(async (sql) => {
    await requireSession(sql, id);

    if ("confirm" in body) {
      // 실제로 파일이 있는지 확인한 뒤에만 업로드 완료로 표시한다.
      const assets = await listAssets(sql, id);
      const asset = assets.find((a) => a.id === body.confirm);
      if (!asset) throw new DomainError("NOT_FOUND", "에셋을 찾을 수 없습니다.");
      const size = await objectSize(asset.storageKey);
      if (size == null) {
        throw new DomainError(
          "INVALID_STATE",
          "업로드된 파일을 찾을 수 없습니다. 다시 올려주세요.",
        );
      }
      await markAssetUploaded(sql, asset.id);
      return ok({ ok: true, assetId: asset.id, size });
    }

    if (!isAllowedImageType(body.mimeType)) {
      return fail("VALIDATION", "지원하지 않는 이미지 형식입니다.", 415);
    }
    const key = buildStorageKey("import", id, body.mimeType);
    const record = await upsertAsset(sql, {
      sessionId: id,
      storageKey: key,
      filename: body.filename,
      mimeType: body.mimeType,
      byteSize: body.size,
      order: body.order,
    });
    return ok(
      {
        assetId: record.id,
        order: record.sortOrder,
        uploadUrl: `/api/uploads?key=${encodeURIComponent(key)}&token=${encodeURIComponent(signUploadToken(key))}`,
      },
      { status: 201 },
    );
  });
});

export const DELETE = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const { assetId } = await readJson(request, z.object({ assetId: z.uuid() }));
  return asAdmin(async (sql) => {
    const storageKey = await deleteAsset(sql, id, assetId);
    await deleteObject(storageKey);
    return ok({ ok: true });
  });
});
