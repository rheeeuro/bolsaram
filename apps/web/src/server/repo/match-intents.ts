/**
 * 멤버가 낸 의사 저장소 (마이그레이션 0026).
 *
 * 멤버가 누르는 것은 결정이 아니라 요청이다 — 여기 행이 생기고, 주선자가 확인해야
 * `match_requests` 가 만들어지거나 상태가 옮겨진다. 상대는 확인 전까지 이 행을
 * 읽을 수 없다(RLS `match_intents_read`).
 */
import "server-only";
import type { Sql } from "@bolsaram/db";
import { DomainError } from "@bolsaram/domain";
import type { MatchIntentKind, MatchIntentStatus } from "@bolsaram/schemas";

export type MatchIntentRecord = {
  id: string;
  profileId: string;
  kind: MatchIntentKind;
  targetProfileId: string | null;
  matchRequestId: string | null;
  message: string | null;
  status: MatchIntentStatus;
  declineReason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
};

type Row = {
  id: string;
  profile_id: string;
  kind: MatchIntentKind;
  target_profile_id: string | null;
  match_request_id: string | null;
  message: string | null;
  status: MatchIntentStatus;
  decline_reason: string | null;
  created_at: Date;
  decided_at: Date | null;
};

const COLUMNS = `id, profile_id, kind, target_profile_id, match_request_id, message,
  status, decline_reason, created_at, decided_at`;

function toRecord(row: Row): MatchIntentRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    kind: row.kind,
    targetProfileId: row.target_profile_id,
    matchRequestId: row.match_request_id,
    message: row.message,
    status: row.status,
    declineReason: row.decline_reason,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

/**
 * 요청을 남긴다. 같은 상대에게 확인 대기 중인 요청이 이미 있으면 부분 유니크
 * 인덱스가 막는다 — 연타가 주선자 큐를 채우지 않는다.
 */
export async function createIntent(
  sql: Sql,
  input: {
    profileId: string;
    kind: MatchIntentKind;
    targetProfileId?: string | null;
    matchRequestId?: string | null;
    message?: string | null;
  },
): Promise<MatchIntentRecord> {
  try {
    const result = await sql.query<Row>(
      `INSERT INTO match_intents
         (profile_id, kind, target_profile_id, match_request_id, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLUMNS}`,
      [
        input.profileId,
        input.kind,
        input.targetProfileId ?? null,
        input.matchRequestId ?? null,
        input.message ?? null,
      ],
    );
    return toRecord(result.rows[0]!);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError("CONFLICT", "이미 주선자가 확인 중인 요청이 있습니다.");
    }
    throw error;
  }
}

export async function findIntentById(
  sql: Sql,
  id: string,
): Promise<MatchIntentRecord | null> {
  const result = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM match_intents WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? toRecord(row) : null;
}

/**
 * 주선자 큐. RLS 가 이미 담당분만 남기므로 여기서 다시 거르지 않는다.
 *
 * **보고 있는 채널로 좁히지 않는다.** 이것은 조회 목록이 아니라 처리해야 끝나는
 * 일감이고, 멤버에게는 알림 채널이 없어 주선자가 확인할 때까지 아무 일도 일어나지
 * 않는다. 채널로 거르면 여러 모임에 속한 주선자가 다른 채널을 보는 동안 요청이
 * 큐에서 사라진 채 잠든다.
 */
export async function listPendingIntents(sql: Sql): Promise<MatchIntentRecord[]> {
  const result = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM match_intents
      WHERE status = 'PENDING'
      ORDER BY created_at ASC
      LIMIT 200`,
  );
  return result.rows.map(toRecord);
}

/**
 * 멤버가 자기 화면에서 「확인 중」을 보기 위한 목록.
 *
 * 아직 확인되지 않은 것만 준다. 멤버에게 보여야 하는 것은 「지금 기다리는 중」이라는
 * 사실이고, 확인이 끝난 요청은 신청 쪽에 결과로 남는다.
 */
export async function listPendingIntentsForProfile(
  sql: Sql,
  profileId: string,
): Promise<MatchIntentRecord[]> {
  const result = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM match_intents
      WHERE profile_id = $1 AND status = 'PENDING'
      ORDER BY created_at DESC
      LIMIT 100`,
    [profileId],
  );
  return result.rows.map(toRecord);
}

/**
 * 승인·반려를 적용한다. `WHERE status = 'PENDING'` 이 동시 처리를 막는다 —
 * 두 주선자가 같은 요청을 눌러도 한 번만 반영된다.
 */
export async function decideIntent(
  sql: Sql,
  input: {
    id: string;
    status: Exclude<MatchIntentStatus, "PENDING">;
    decidedBy: string;
    declineReason?: string | null;
  },
): Promise<MatchIntentRecord> {
  const result = await sql.query<Row>(
    `UPDATE match_intents
        SET status = $2, decided_by = $3, decline_reason = $4
      WHERE id = $1 AND status = 'PENDING'
      RETURNING ${COLUMNS}`,
    [input.id, input.status, input.decidedBy, input.declineReason ?? null],
  );
  const row = result.rows[0];
  if (!row) {
    throw new DomainError("CONFLICT", "이미 처리된 요청입니다.");
  }
  return toRecord(row);
}

/**
 * 보류한 요청 목록. 확인 대기 큐에서 빠진 요청을 다시 찾아 되돌릴 수 있게 한다.
 *
 * 큐와 같은 이유로 보고 있는 채널로 좁히지 않는다 — RLS 가 담당 멤버의 것만 남긴다.
 * 최근에 보류한 것부터 보여준다.
 */
export async function listDeclinedIntents(sql: Sql): Promise<MatchIntentRecord[]> {
  const result = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM match_intents
      WHERE status = 'DECLINED'
      ORDER BY decided_at DESC
      LIMIT 50`,
  );
  return result.rows.map(toRecord);
}

/**
 * 보류를 풀고 확인 대기로 되돌린다. 보류는 「지금은 아니다」라서 되돌릴 수 있다(0030).
 *
 * 처리 기록(누가·언제·왜)을 함께 비운다 — `match_intents_decision_pair` 가 대기 상태에
 * 결정 시각을 허용하지 않는다. `WHERE status = 'DECLINED'` 가 동시 처리를 막는다.
 * 그사이 멤버가 같은 요청을 다시 냈다면 대기 중 하나만 허용하는 인덱스가 막는다.
 */
export async function reopenIntent(sql: Sql, id: string): Promise<MatchIntentRecord> {
  try {
    const result = await sql.query<Row>(
      `UPDATE match_intents
          SET status = 'PENDING', decided_by = NULL, decided_at = NULL, decline_reason = NULL
        WHERE id = $1 AND status = 'DECLINED'
        RETURNING ${COLUMNS}`,
      [id],
    );
    const row = result.rows[0];
    if (!row) {
      throw new DomainError("CONFLICT", "보류 상태가 아닌 요청입니다.");
    }
    return toRecord(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError("CONFLICT", "같은 요청이 이미 확인을 기다리고 있습니다.");
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}
