/**
 * POST /api/profiles/:id/consent — 등록 동의를 기록한다 (관리자).
 *
 * 프로필은 주선자가 남을 대신해 등록하므로, 공개하려면 본인에게 확인했다는 기록이
 * 있어야 한다(마이그레이션 0019). 여기서는 **기록만** 하고, 공개 여부는 상태 API 가
 * 이 기록을 보고 판정한다.
 */
import { DomainError } from "@bolsaram/domain";
import { consentRecordSchema } from "@bolsaram/schemas";
import { writeAudit } from "@/server/audit";
import { asAdmin } from "@/server/http/context";
import { ok, readJson, route } from "@/server/http/respond";
import { recordConsent } from "@/server/repo/profiles";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const POST = route(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const input = await readJson(request, consentRecordSchema);
  return asAdmin(async (sql, viewer) => {
    // RLS 의 profiles_admin_write 가 남의 프로필을 걸러낸다(0행 → NOT_FOUND).
    const updated = await recordConsent(sql, id, input, viewer.userId);
    if (!updated) throw new DomainError("NOT_FOUND", "프로필을 찾을 수 없습니다.");

    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "profile.consent",
      entityType: "profile",
      entityId: id,
      // 메모 본문은 남기지 않는다 — 감사 로그에 대화 내용이 흘러들지 않게.
      metadata: { method: input.method, confirmedAt: input.confirmedAt },
    });
    return ok({ ok: true });
  });
});
