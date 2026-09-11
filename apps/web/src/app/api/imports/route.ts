/**
 * POST /api/imports — Import 세션 생성 + 에셋별 signed upload 슬롯 발급
 *
 * 모바일 가이드의 업로드 계약과 같다. 클라이언트는 여기서 받은 uploadUrl 로
 * 직접 PUT 한 뒤 `POST /api/imports/:id/assets` 로 확정한다.
 */
import { createImportSessionSchema } from "@bolsaram/schemas";
import { assertGroupAdmin } from "@/server/auth/group-invite";
import { writeAudit } from "@/server/audit";
import { asAdmin } from "@/server/http/context";
import { fail, ok, readJson, route } from "@/server/http/respond";
import { createSession, listInbox, upsertAsset } from "@/server/repo/imports";
import { buildStorageKey, isAllowedImageType, signUploadToken } from "@/server/storage/local";

export const dynamic = "force-dynamic";

export const GET = route(async () =>
  asAdmin(async (sql, viewer) => {
    const items = await listInbox(sql, { groupId: viewer.groupId });
    return ok({ items });
  }),
);

export const POST = route(async (request: Request) => {
  const input = await readJson(request, createImportSessionSchema);

  for (const asset of input.assets) {
    if (!isAllowedImageType(asset.mimeType)) {
      return fail("VALIDATION", `지원하지 않는 이미지 형식입니다: ${asset.mimeType}`, 415);
    }
  }

  // 어느 방에 넣을지는 **올리는 쪽이 말한다**(`groupId`). null 이면 전체공개다 —
  // 모임이 없는 주선자도 그렇게 올린다. 세션의 방은 검토 화면에서 바꿀 수 있다.
  return asAdmin(async (sql, viewer) => {
    if (input.groupId) await assertGroupAdmin(viewer.userId, input.groupId);
    const session = await createSession(sql, {
      groupId: input.groupId,
      createdBy: viewer.userId,
      source: input.source,
      ...(input.rawText ? { rawText: input.rawText } : {}),
    });

    const slots = [];
    for (const asset of input.assets) {
      const key = buildStorageKey("import", session.id, asset.mimeType);
      const record = await upsertAsset(sql, {
        sessionId: session.id,
        storageKey: key,
        filename: asset.filename,
        mimeType: asset.mimeType,
        byteSize: asset.size,
        order: asset.order,
      });
      slots.push({
        assetId: record.id,
        order: record.sortOrder,
        // 서버가 정한 key 로만 올릴 수 있다.
        uploadUrl: `/api/uploads?key=${encodeURIComponent(key)}&token=${encodeURIComponent(signUploadToken(key))}`,
      });
    }

    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "import.create",
      entityType: "import_session",
      entityId: session.id,
      metadata: { source: input.source, assetCount: slots.length, groupId: session.groupId },
    });

    return ok({ id: session.id, status: session.status, assets: slots }, { status: 201 });
  });
});
