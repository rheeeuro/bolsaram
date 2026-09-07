/**
 * 텔레그램 계정 연결 관리 (설계 변경 문서 TELEGRAM v1 §14).
 *
 *   GET    현재 연결 상태
 *   POST   연결 코드 발급 (주선자당 하나, 15분)
 *   DELETE 연결 해제 (진행 중이던 대화도 닫는다)
 *
 * 평문 코드는 발급 응답에 한 번만 실린다. 다시 조회할 수 없고 로그에 남기지 않는다.
 */
import { requireAdmin, rlsContextOf } from "@/server/auth/guard";
import { issueTelegramLinkCode } from "@/server/auth/telegram";
import { isTelegramEnabled } from "@/server/env";
import { asAdmin } from "@/server/http/context";
import { fail, ok, route } from "@/server/http/respond";
import { deleteConnectionForUser, findConnectionForUser } from "@/server/repo/telegram";
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
    });
  }),
);

export const POST = route(async () => {
  if (!isTelegramEnabled()) {
    return fail("INVALID_STATE", "텔레그램 채널이 켜져 있지 않습니다.", 422);
  }
  const viewer = await requireAdmin();

  // 봇 이름은 딥링크를 만들기 위한 것이다. 못 가져와도 코드 발급은 진행한다.
  const botUsername = await getBotUsername().catch(() => null);
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
