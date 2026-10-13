/**
 * 관리자 — 서비스 전체 설정과 모임 만들기 승인.
 *
 * 관리자는 DB 역할이 아니다. `SEED_ADMIN_EMAIL1` 과 이메일이 같은 **주선자 계정**
 * 하나이며 판정은 세션을 읽을 때 한다(`SessionUser.isOperator`). RLS 는 관리자를
 * 모르므로 여기서 다루는 테이블(`operator_settings` · `group_creation_requests`)은
 * 런타임 롤 권한이 없고 owner 커넥션으로만 읽고 쓴다(0064). 관리자인지 확인하는 것은
 * 전적으로 호출부의 `requireOperator` 몫이다.
 *
 * 승인으로 모임을 만드는 일은 소속을 바꾸는 일이라 `group-invite.ts` 에 있다.
 */
import "server-only";
import { withOwner, withOwnerTx } from "@bolsaram/db";
import { writeAudit } from "../audit";

export type OperatorSettings = {
  /** 켜져 있으면 주선자의 모임 만들기가 관리자 승인을 기다린다. */
  groupCreationRequiresApproval: boolean;
  updatedAt: Date;
};

export async function readOperatorSettings(): Promise<OperatorSettings> {
  return withOwner(async (sql) => {
    const result = await sql.query<{
      group_creation_requires_approval: boolean;
      updated_at: Date;
    }>(`SELECT group_creation_requires_approval, updated_at FROM operator_settings`);
    const row = result.rows[0];
    // 한 줄은 마이그레이션이 넣어 둔다. 없으면 승인 없이 도는 기본값으로 본다.
    return {
      groupCreationRequiresApproval: row?.group_creation_requires_approval ?? false,
      updatedAt: row?.updated_at ?? new Date(0),
    };
  });
}

export async function setGroupCreationApproval(input: {
  operatorId: string;
  enabled: boolean;
}): Promise<OperatorSettings> {
  return withOwnerTx(async (sql) => {
    const result = await sql.query<{
      group_creation_requires_approval: boolean;
      updated_at: Date;
    }>(
      `INSERT INTO operator_settings (id, group_creation_requires_approval, updated_by)
       VALUES (true, $1, $2)
       ON CONFLICT (id) DO UPDATE
         SET group_creation_requires_approval = EXCLUDED.group_creation_requires_approval,
             updated_by = EXCLUDED.updated_by
       RETURNING group_creation_requires_approval, updated_at`,
      [input.enabled, input.operatorId],
    );
    await writeAudit(sql, {
      actorUserId: input.operatorId,
      action: "operator.group_approval.set",
      entityType: "operator_settings",
      metadata: { enabled: input.enabled },
    });
    const row = result.rows[0]!;
    return {
      groupCreationRequiresApproval: row.group_creation_requires_approval,
      updatedAt: row.updated_at,
    };
  });
}

export type GroupCreationRequestRow = {
  requestId: string;
  name: string;
  description: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELED";
  createdAt: Date;
  decidedAt: Date | null;
  requester: {
    userId: string;
    displayName: string | null;
    email: string | null;
    /** 지금 속한 모임 수. 승인하면 하나 늘어난다 — 상한에 걸리는지 미리 본다. */
    groupCount: number;
  };
};

/** 처리한 요청을 이만큼만 아래에 남긴다. 기록 전체는 감사 로그에 있다. */
const RECENT_DECIDED_LIMIT = 20;

/**
 * 관리자 화면의 요청 목록 — 기다리는 것 전부(오래된 것부터)와 최근에 끝난 것.
 */
export async function listGroupCreationRequests(): Promise<{
  pending: GroupCreationRequestRow[];
  recent: GroupCreationRequestRow[];
}> {
  return withOwner(async (sql) => {
    const select = `
      SELECT r.id, r.name, r.description, r.status, r.created_at, r.decided_at,
             u.id AS user_id, u.display_name, u.email::text AS email,
             (SELECT count(*)::int FROM group_admins ga WHERE ga.user_id = u.id) AS group_count
        FROM group_creation_requests r
        JOIN users u ON u.id = r.requested_by`;
    type Row = {
      id: string;
      name: string;
      description: string | null;
      status: GroupCreationRequestRow["status"];
      created_at: Date;
      decided_at: Date | null;
      user_id: string;
      display_name: string | null;
      email: string | null;
      group_count: number;
    };
    const pending = await sql.query<Row>(
      `${select} WHERE r.status = 'PENDING' ORDER BY r.created_at`,
    );
    const recent = await sql.query<Row>(
      `${select} WHERE r.status <> 'PENDING' ORDER BY r.decided_at DESC LIMIT $1`,
      [RECENT_DECIDED_LIMIT],
    );
    const toRow = (row: Row): GroupCreationRequestRow => ({
      requestId: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      createdAt: row.created_at,
      decidedAt: row.decided_at,
      requester: {
        userId: row.user_id,
        displayName: row.display_name,
        email: row.email,
        groupCount: row.group_count,
      },
    });
    return { pending: pending.rows.map(toRow), recent: recent.rows.map(toRow) };
  });
}

/** 기다리는 요청 수. 내비게이션의 관리자 메뉴 배지에 쓴다. */
export async function countPendingGroupCreationRequests(): Promise<number> {
  return withOwner(async (sql) => {
    const result = await sql.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM group_creation_requests WHERE status = 'PENDING'`,
    );
    return result.rows[0]?.count ?? 0;
  });
}
