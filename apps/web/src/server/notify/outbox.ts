/**
 * 알림 아웃박스 저장소 (마이그레이션 0017).
 *
 * **owner 커넥션을 쓰는 유일한 비인증 경로다.** 이유는 두 가지다.
 *   * 알림을 만드는 것은 회원인데, 회원의 RLS 컨텍스트에서는 담당 주선자가 누구인지도
 *     그 사람의 텔레그램 연결도 읽을 수 없다.
 *   * 발송은 요청과 무관한 배경 작업이라 애초에 세션 컨텍스트가 없다.
 *
 * 대신 **닿는 범위를 좁게 유지한다** — 이 파일은 `notifications` 와
 * `telegram_connections` 만 만진다. 프로필·신청 내용은 읽지 않는다(트리거가 넣어 둔
 * 공개 번호만 payload 로 받는다).
 */
import "server-only";
import { NOTIFICATION_MAX_ATTEMPTS, NOTIFICATION_RETRY_WINDOW_DAYS } from "@bolsaram/domain";
import { withOwner } from "@bolsaram/db";
import type { MatchIntentKind } from "@bolsaram/schemas";

/** 한 번에 집는 개수. */
const BATCH = 20;

export type ClaimedNotification = {
  id: string;
  kind:
    | "MATCH_REQUESTED"
    | "MATCH_ACCEPTED"
    | "MATCH_REJECTED"
    | "MATCH_CANCELED"
    | "MEMBER_INTENT"
    | "INTENT_DECLINED";
  chatId: number;
  requesterCode: number | null;
  targetCode: number | null;
  /** 요청 알림(MEMBER_INTENT · INTENT_DECLINED)일 때만 채워진다 — 무슨 요청인지. */
  intentKind: MatchIntentKind | null;
};

type ClaimRow = {
  id: string;
  kind: ClaimedNotification["kind"];
  telegram_chat_id: number;
  requester_code: number | null;
  target_code: number | null;
  intent_kind: MatchIntentKind | null;
};

/**
 * 보낼 알림을 원자적으로 선점한다. `attempts` 를 올리면서 가져오므로 같은 행을
 * 두 워커가 동시에 집지 않고, 발송 중에 프로세스가 죽어도 시도 횟수 하나만 잃는다.
 * 네트워크 호출은 이 트랜잭션 **밖에서** 한다.
 *
 * 텔레그램에 연결되지 않은 주선자의 알림은 애초에 집지 않는다 — 나중에 연결하면
 * 그때 나가고, 그 전에 낡으면 정리 작업이 지운다.
 */
export async function claimPending(): Promise<ClaimedNotification[]> {
  return withOwner(async (sql) => {
    const result = await sql.query<ClaimRow>(
      `UPDATE notifications n
          SET attempts = n.attempts + 1
        WHERE n.id IN (
          SELECT p.id
            FROM notifications p
            JOIN telegram_connections tc ON tc.user_id = p.recipient_user_id
           WHERE p.sent_at IS NULL
             AND p.attempts < $1
             AND p.created_at > now() - make_interval(days => $2)
           ORDER BY p.created_at
           FOR UPDATE OF p SKIP LOCKED
           LIMIT $3
        )
        RETURNING n.id,
                  n.kind,
                  (SELECT tc.telegram_chat_id FROM telegram_connections tc
                    WHERE tc.user_id = n.recipient_user_id) AS telegram_chat_id,
                  (n.payload->>'requesterCode')::int AS requester_code,
                  (n.payload->>'targetCode')::int AS target_code,
                  n.payload->>'intentKind' AS intent_kind`,
      [NOTIFICATION_MAX_ATTEMPTS, NOTIFICATION_RETRY_WINDOW_DAYS, BATCH],
    );
    return result.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      chatId: row.telegram_chat_id,
      requesterCode: row.requester_code,
      targetCode: row.target_code,
      intentKind: row.intent_kind,
    }));
  });
}

export async function markSent(id: string): Promise<void> {
  await withOwner(async (sql) => {
    await sql.query(`UPDATE notifications SET sent_at = now(), last_error = NULL WHERE id = $1`, [
      id,
    ]);
  });
}

/** 실패 원인은 짧은 문장만 남긴다 — 토큰이 든 URL 이나 원문을 남기지 않는다. */
export async function markFailed(id: string, reason: string): Promise<void> {
  await withOwner(async (sql) => {
    await sql.query(`UPDATE notifications SET last_error = $2 WHERE id = $1`, [
      id,
      reason.slice(0, 200),
    ]);
  });
}
