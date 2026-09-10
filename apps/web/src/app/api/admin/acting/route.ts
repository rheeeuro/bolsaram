/**
 * POST /api/admin/acting   — 대행 시작
 * DELETE /api/admin/acting — 대행 종료
 *
 * 등록된 사람이 자기 휴대폰을 쓰지 않는 것이 정상 운영이다. 그때 주선자가 자기 폰으로
 * 회원 화면을 대신 조작한다. 예전에는 초대 링크를 주선자가 직접 여는 수밖에 없었고,
 * 그러면 주선자가 로그아웃되고 초대가 소진되며 회원 목록이 오염됐다.
 *
 * 여기서는 주선자 세션을 그대로 두고 「회원으로서 보는 프로필」만 갈아끼운다.
 * 초대는 건드리지 않는다.
 *
 * 본인 계정이 연결된 프로필도 대상이다(0035). 연결은 초대를 한 번 열었다는 뜻일 뿐,
 * 그 뒤에도 휴대폰을 쓰지 않아 주선자가 대신 봐야 하는 사람이 있다.
 *
 * 경계는 두 곳에서 중복으로 본다.
 *   - 여기: `app_can_edit_profile`
 *   - RLS : `app_current_profile_id()` 가 요청마다 같은 조건을 다시 본다(0025·0035)
 */
import { withRls } from "@bolsaram/db";
import { DomainError } from "@bolsaram/domain";
import { actingStartSchema } from "@bolsaram/schemas";
import { writeAudit } from "@/server/audit";
import { requireAdmin, rlsContextOf } from "@/server/auth/guard";
import { setActingProfile } from "@/server/auth/session";
import { ok, readJson, route } from "@/server/http/respond";
import { assertCanEditProfile } from "@/server/repo/profiles";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const viewer = await requireAdmin();
  const input = await readJson(request, actingStartSchema);

  await withRls(rlsContextOf(viewer), async (sql) => {
    await assertCanEditProfile(sql, input.profileId);

    // 연결 여부는 막지 않지만 감사에는 남긴다 — 본인이 직접 쓰는 계정을 대신 조작한
    // 기록은 나중에 구분할 수 있어야 한다.
    const result = await sql.query<{ claimed: boolean }>(
      `SELECT user_id IS NOT NULL AS claimed FROM profiles WHERE id = $1`,
      [input.profileId],
    );
    const row = result.rows[0];
    if (!row) throw new DomainError("NOT_FOUND", "프로필을 찾을 수 없습니다.");

    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "acting.start",
      entityType: "profile",
      entityId: input.profileId,
      metadata: { claimed: row.claimed },
    });
  });

  await setActingProfile(input.profileId);
  return ok({ ok: true, profileId: input.profileId });
});

export const DELETE = route(async () => {
  const viewer = await requireAdmin();

  // 이미 끝난 대행을 한 번 더 지우는 것은 오류가 아니다 — 기록만 남긴다.
  if (viewer.actingProfileId) {
    await withRls(rlsContextOf(viewer), (sql) =>
      writeAudit(sql, {
        actorUserId: viewer.userId,
        action: "acting.stop",
        entityType: "profile",
        entityId: viewer.actingProfileId!,
        metadata: {},
      }),
    );
  }

  await setActingProfile(null);
  return ok({ ok: true });
});
