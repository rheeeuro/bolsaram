/**
 * 텔레그램 계정 연결 관리 (설계 변경 문서 TELEGRAM v1 §14).
 *
 *   GET    현재 연결 상태
 *   POST   연결 코드 발급 (주선자당 하나, 15분)
 *   PATCH  봇으로 보낸 프로필을 담을 모임 변경
 *   DELETE 연결 해제 (진행 중이던 대화도 닫는다)
 *
 * 평문 코드는 발급 응답에 한 번만 실린다. 다시 조회할 수 없고 로그에 남기지 않는다.
 */
import { telegramUploadGroupSchema } from "@bolsaram/schemas";
import { requireAdmin, rlsContextOf } from "@/server/auth/guard";
import { assertGroupAdmin } from "@/server/auth/group-invite";
import { issueTelegramLinkCode } from "@/server/auth/telegram";
import { isTelegramEnabled } from "@/server/env";
import { asAdmin } from "@/server/http/context";
import { fail, ok, readJson, route } from "@/server/http/respond";
import {
  deleteConnectionForUser,
  findConnectionForUser,
  setUploadGroupForUser,
} from "@/server/repo/telegram";
import { getBotUsername } from "@/server/telegram/client";
import { withRls } from "@bolsaram/db";
import { writeAudit } from "@/server/audit";

export const dynamic = "force-dynamic";

export const GET = route(async () =>
  asAdmin(async (sql, viewer) => {
    const connection = await findConnectionForUser(sql, viewer.userId);
    return ok({
      enabled: isTelegramEnabled(),
      connected: connection != null,
      linkedAt: connection?.linkedAt ?? null,
      lastSeenAt: connection?.lastSeenAt ?? null,
      uploadGroupId: connection?.uploadGroupId ?? null,
    });
  }),
);

export const POST = route(async () => {
  if (!isTelegramEnabled()) {
    return fail("INVALID_STATE", "텔레그램 채널이 켜져 있지 않습니다.", 422);
  }
  const viewer = await requireAdmin();

  // 봇 이름은 딥링크를 만들기 위한 것이다. 못 가져와도 코드 발급은 진행하지만,
  // 왜 못 가져왔는지는 반드시 남긴다 — 토큰 오설정을 조용히 넘기면 찾을 방법이 없다.
  const botUsername = await getBotUsername().catch((error: unknown) => {
    console.error(
      "텔레그램 봇 이름 조회 실패 — 딥링크 없이 코드만 발급합니다",
      error instanceof Error ? `${error.name}: ${error.message}` : error,
    );
    return null;
  });
  const issued = await issueTelegramLinkCode(viewer.userId, botUsername ?? undefined);

  await withRls(rlsContextOf(viewer), (sql) =>
    writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "telegram.link_code.issue",
      entityType: "user",
      entityId: viewer.userId,
    }),
  );

  return ok({
    code: issued.code,
    expiresAt: issued.expiresAt,
    deepLink: issued.deepLink,
  });
});

/**
 * 담을 모임 변경. 봇의 `/room` 과 같은 값을 고친다(0039).
 *
 * 소속 확인은 정책(`telegram_connections_own` 의 WITH CHECK)과 여기 둘 다에서 한다 —
 * 정책만 믿으면 속하지 않은 모임을 골랐을 때 이유 없이 0건으로 끝난다.
 */
export const PATCH = route(async (request: Request) => {
  const input = await readJson(request, telegramUploadGroupSchema);
  return asAdmin(async (sql, viewer) => {
    if (input.groupId) await assertGroupAdmin(viewer.userId, input.groupId);
    const changed = await setUploadGroupForUser(sql, viewer.userId, input.groupId);
    if (!changed) {
      return fail("NOT_FOUND", "연결된 텔레그램 계정이 없습니다.", 404);
    }
    await writeAudit(sql, {
      actorUserId: viewer.userId,
      action: "telegram.upload_group.set",
      entityType: "user",
      entityId: viewer.userId,
      metadata: { groupId: input.groupId },
    });
    return ok({ uploadGroupId: input.groupId });
  });
});

export const DELETE = route(async () =>
  asAdmin(async (sql, viewer) => {
    const removed = await deleteConnectionForUser(sql, viewer.userId);
    if (removed) {
      await writeAudit(sql, {
        actorUserId: viewer.userId,
        action: "telegram.unlink",
        entityType: "user",
        entityId: viewer.userId,
      });
    }
    return ok({ ok: true, removed });
  }),
);
