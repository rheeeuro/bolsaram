/**
 * 주선자가 손을 대야 끝나는 일의 개수. 홈의 「오늘 할 일」과 메뉴 배지가 함께 읽는다.
 *
 * 범위는 각 일을 처리하는 화면과 같다 — 배지를 눌러 간 화면에 그 수만큼 보여야 한다.
 *
 * - 확인 대기 요청: **채널로 좁히지 않는다.** 신청 화면도 전부 보여준다
 *   (`listPendingIntents` 의 이유와 같다 — 다른 채널을 보는 동안 잠들면 안 된다).
 * - 받은 신청 알리기: 보고 있는 채널 안에서, 받는 쪽이 내 담당인 것. 멤버에게는
 *   알림이 없어 주선자가 카카오톡으로 전해야 답이 온다.
 * - 가져오기 검토: 보고 있는 채널의 끝나지 않은 세션(가져오기 화면의 「검토 대기」).
 * - 초대 보내기: 보고 있는 채널의 담당분 중 초대 화면의 「아직 안 보냄」「기한 지남」.
 *   보내고 기다리는 중인 분은 할 일이 아니라 세지 않는다.
 */
import "server-only";
import type { Sql } from "@bolsaram/db";

export type HostTodo = {
  intentsPending: number;
  requestsToRelay: number;
  importsPending: number;
  invitesToSend: number;
};

export async function countHostTodo(sql: Sql, groupId: string | null): Promise<HostTodo> {
  const result = await sql.query<HostTodo>(
    `
    SELECT
      (SELECT count(*) FROM match_intents WHERE status = 'PENDING')::int AS "intentsPending",
      (SELECT count(*) FROM match_requests r
        WHERE r.status = 'REQUESTED'
          AND app_can_edit_profile(r.target_profile_id)
          AND EXISTS (SELECT 1 FROM profiles p
                       WHERE p.id = r.requester_profile_id
                         AND p.group_id IS NOT DISTINCT FROM $1))::int AS "requestsToRelay",
      (SELECT count(*) FROM import_sessions
        WHERE group_id IS NOT DISTINCT FROM $1
          AND status IN ('RECEIVED','UPLOADING','ANALYZING','REVIEW_REQUIRED','READY','FAILED'))::int
        AS "importsPending",
      (SELECT count(*) FROM profiles p
        WHERE p.group_id IS NOT DISTINCT FROM $1
          AND p.user_id IS NULL
          AND app_can_edit_profile(p.id)
          -- 초대 화면과 같은 판정: 최근 초대 한 건이 아직 열 수 있으면 「기다림」이다.
          AND NOT EXISTS (
            SELECT 1 FROM (
              SELECT expires_at, claimed_at FROM invites
               WHERE profile_id = p.id AND revoked_at IS NULL
               ORDER BY created_at DESC LIMIT 1
            ) i
             WHERE i.claimed_at IS NULL AND i.expires_at >= now()
          ))::int AS "invitesToSend"
    `,
    [groupId],
  );
  return result.rows[0]!;
}
