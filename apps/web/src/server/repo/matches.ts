/**
 * MatchRequest 저장소.
 * 상태 전이 판정은 @bolsaram/domain 의 resolveTransition 이 하고, 여기서는
 * 그 결과를 조건부 UPDATE 로 적용한다 — `WHERE status = <from>` 이 race condition 을 막는다.
 */
import "server-only";
import type { Sql } from "@bolsaram/db";
import {
  DomainError,
  assertCanCreateRequest,
  resolveTransition,
  type MatchAction,
  type MatchActor,
} from "@bolsaram/domain";
import type { MatchRequestStatus } from "@bolsaram/schemas";

export type MatchRequestRecord = {
  id: string;
  requesterProfileId: string;
  targetProfileId: string;
  status: MatchRequestStatus;
  message: string | null;
  rejectReason: string | null;
  introduceNote: string | null;
  requestedAt: Date;
  respondedAt: Date | null;
  introducedAt: Date | null;
  closedAt: Date | null;
};

type Row = {
  id: string;
  requester_profile_id: string;
  target_profile_id: string;
  status: MatchRequestStatus;
  message: string | null;
  reject_reason: string | null;
  introduce_note: string | null;
  requested_at: Date;
  responded_at: Date | null;
  introduced_at: Date | null;
  closed_at: Date | null;
};

const COLUMNS = `id, requester_profile_id, target_profile_id, status, message,
  reject_reason, introduce_note, requested_at, responded_at, introduced_at, closed_at`;

function toRecord(row: Row): MatchRequestRecord {
  return {
    id: row.id,
    requesterProfileId: row.requester_profile_id,
    targetProfileId: row.target_profile_id,
    status: row.status,
    message: row.message,
    rejectReason: row.reject_reason,
    introduceNote: row.introduce_note,
    requestedAt: row.requested_at,
    respondedAt: row.responded_at,
    introducedAt: row.introduced_at,
    closedAt: row.closed_at,
  };
}

export async function findActiveBetween(
  sql: Sql,
  a: string,
  b: string,
): Promise<MatchRequestRecord | null> {
  const result = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM match_requests
      WHERE status IN ('REQUESTED','ACCEPTED','INTRODUCED')
        AND ((requester_profile_id = $1 AND target_profile_id = $2)
          OR (requester_profile_id = $2 AND target_profile_id = $1))
      ORDER BY requested_at DESC LIMIT 1`,
    [a, b],
  );
  const row = result.rows[0];
  return row ? toRecord(row) : null;
}

export async function createMatchRequest(
  sql: Sql,
  input: { requesterProfileId: string; targetProfileId: string; message?: string },
): Promise<MatchRequestRecord> {
  const existing = await findActiveBetween(
    sql,
    input.requesterProfileId,
    input.targetProfileId,
  );

  // 도메인 규칙 먼저(자기 자신 / 활성 중복). DB 의 부분 유니크 인덱스가 최종 방어선이다.
  assertCanCreateRequest({
    requesterProfileId: input.requesterProfileId,
    targetProfileId: input.targetProfileId,
    existingActiveStatus: existing?.status ?? null,
  });

  try {
    const result = await sql.query<Row>(
      `INSERT INTO match_requests (requester_profile_id, target_profile_id, message)
       VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
      [input.requesterProfileId, input.targetProfileId, input.message ?? null],
    );
    return toRecord(result.rows[0]!);
  } catch (error) {
    // 23505 = unique_violation. 동시 요청 두 개가 검사를 함께 통과한 경우다.
    if (isUniqueViolation(error)) {
      throw new DomainError("CONFLICT", "이미 진행 중인 신청이 있습니다.");
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "23505"
  );
}

export async function findById(sql: Sql, id: string): Promise<MatchRequestRecord | null> {
  const result = await sql.query<Row>(`SELECT ${COLUMNS} FROM match_requests WHERE id = $1`, [
    id,
  ]);
  const row = result.rows[0];
  return row ? toRecord(row) : null;
}

/** 요청자 시점에서 이 신청에 대한 행위자 역할을 판정한다. */
export function actorFor(
  record: MatchRequestRecord,
  viewer: { role: "ADMIN" | "MEMBER"; profileId: string | null },
): MatchActor {
  if (viewer.profileId === record.requesterProfileId) return "requester";
  if (viewer.profileId === record.targetProfileId) return "target";
  if (viewer.role === "ADMIN") return "admin";
  throw new DomainError("FORBIDDEN", "이 신청에 접근할 수 없습니다.");
}

/**
 * 상태를 전이한다. 도메인이 허용한 전이만, 그리고 현재 상태가 여전히 `from` 일 때만 적용된다.
 * 다른 요청이 먼저 상태를 바꿨다면 0행이 갱신되고 CONFLICT 를 던진다.
 */
export async function transition(
  sql: Sql,
  input: {
    id: string;
    action: MatchAction;
    actor: MatchActor;
    current: MatchRequestStatus;
    rejectReason?: string;
    introduceNote?: string;
  },
): Promise<MatchRequestRecord> {
  const { from, to } = resolveTransition({
    action: input.action,
    current: input.current,
    actor: input.actor,
  });

  const sets = ["status = $3"];
  const values: unknown[] = [input.id, from, to];
  if (input.rejectReason !== undefined) {
    values.push(input.rejectReason);
    sets.push(`reject_reason = $${values.length}`);
  }
  if (input.introduceNote !== undefined) {
    values.push(input.introduceNote);
    sets.push(`introduce_note = $${values.length}`);
  }

  const result = await sql.query<Row>(
    `UPDATE match_requests SET ${sets.join(", ")}
      WHERE id = $1 AND status = $2
      RETURNING ${COLUMNS}`,
    values,
  );
  const row = result.rows[0];
  if (!row) {
    throw new DomainError(
      "CONFLICT",
      "그 사이 상태가 바뀌었습니다. 새로고침 후 다시 시도해 주세요.",
    );
  }
  return toRecord(row);
}

export type SignalDirection = "incoming" | "outgoing" | "connected";

export async function listSignals(
  sql: Sql,
  profileId: string,
  direction: SignalDirection,
): Promise<MatchRequestRecord[]> {
  const clause =
    direction === "incoming"
      ? `target_profile_id = $1 AND status IN ('REQUESTED','REJECTED')`
      : direction === "outgoing"
        ? `requester_profile_id = $1 AND status IN ('REQUESTED','REJECTED','CANCELED')`
        : `(requester_profile_id = $1 OR target_profile_id = $1)
           AND status IN ('ACCEPTED','INTRODUCED','CLOSED')`;

  const result = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM match_requests
      WHERE ${clause}
      ORDER BY requested_at DESC
      LIMIT 200`,
    [profileId],
  );
  return result.rows.map(toRecord);
}

/** 관리자 신청 목록. 처리 대기 중인 것을 위로 올린다. */
export async function listForAdmin(
  sql: Sql,
  filter: { status?: MatchRequestStatus[] },
): Promise<MatchRequestRecord[]> {
  const values: unknown[] = [];
  let clause = "TRUE";
  if (filter.status?.length) {
    values.push(filter.status);
    clause = `status = ANY($1)`;
  }
  const result = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM match_requests
      WHERE ${clause}
      ORDER BY
        CASE status WHEN 'ACCEPTED' THEN 0 WHEN 'REQUESTED' THEN 1 ELSE 2 END,
        requested_at DESC
      LIMIT 200`,
    values,
  );
  return result.rows.map(toRecord);
}

/** 상대와 INTRODUCED 상태인 프로필 id 집합. 이름/연락처 공개 판정에 쓴다. */
export async function introducedPartnerIds(sql: Sql, profileId: string): Promise<Set<string>> {
  const result = await sql.query<{ other: string }>(
    `SELECT CASE WHEN requester_profile_id = $1 THEN target_profile_id
                 ELSE requester_profile_id END AS other
       FROM match_requests
      WHERE status = 'INTRODUCED'
        AND (requester_profile_id = $1 OR target_profile_id = $1)`,
    [profileId],
  );
  return new Set(result.rows.map((r) => r.other));
}
