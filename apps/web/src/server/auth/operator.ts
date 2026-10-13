/**
 * 관리자 — 서비스 전체 설정(모임 만들기 승인·초대 코드 여러 번 쓰기), 모임 만들기 승인,
 * 주선자 목록과 정지.
 *
 * 관리자는 DB 역할이 아니다. `SEED_ADMIN_EMAIL1` 과 이메일이 같은 **주선자 계정**
 * 하나이고, `syncOperatorAccount` 가 그 계정을 `operator_settings.operator_user_id` 에
 * 적어 둔다. 세션(`SessionUser.isOperator`)과 RLS(`app_is_operator()`)가 모두 이 칸을
 * 읽는다 — 관리자는 모든 모임·프로필을 모임장·등록한 주선자처럼 다룬다(0065).
 *
 * 관리자 설정·모임 만들기 요청·정지 테이블은 런타임 롤 권한이 없고 owner 커넥션으로만
 * 읽고 쓴다(0064·0067). 관리자 메뉴의 경로는 `requireOperator` 가 막는다.
 *
 * 승인으로 모임을 만드는 일은 소속을 바꾸는 일이라 `group-invite.ts` 에 있다.
 */
import "server-only";
import { withOwner, withOwnerTx, type Sql } from "@bolsaram/db";
import { DomainError } from "@bolsaram/domain";
import { writeAudit } from "../audit";

/**
 * 환경변수의 관리자 이메일을 DB 에 맞춘다. 기동할 때와 소셜 로그인 직후에 부른다.
 *
 * 관리자는 **어느 모임에도 속하지 않는다** — 모든 모임에 이미 접근하므로 소속이 있으면
 * 「누가 이 모임 주선자인가」가 흐려진다. 그래서 지정하면서 기존 소속을 걷어낸다.
 * 모임장이었던 모임은 가장 먼저 들어온 다른 주선자에게 넘기고, 혼자였던 모임은
 * 주선자 없이 남는다(관리자가 계속 다룬다). 걷어낼 때 「나가기」 뒷정리(프로필
 * 비활성·퇴장 안내)는 트리거가 건너뛴다(0065).
 *
 * 맞는 주선자 계정이 없으면 관리자를 비운다. 이메일을 바꾸면 이전 관리자는 보통
 * 주선자로 돌아가고, 걷어낸 소속은 되살아나지 않는다.
 */
export async function syncOperatorAccount(email: string | undefined): Promise<string | null> {
  return withOwnerTx(async (sql) => {
    const found = email
      ? await sql.query<{ id: string }>(
          `SELECT id FROM users WHERE role = 'ADMIN' AND email = $1::citext`,
          [email.trim()],
        )
      : null;
    const operatorId = found?.rows[0]?.id ?? null;

    // 트리거가 이 값을 보고 뒷정리를 건너뛰므로 소속보다 먼저 적는다.
    await sql.query(
      `UPDATE operator_settings SET operator_user_id = $1
        WHERE operator_user_id IS DISTINCT FROM $1`,
      [operatorId],
    );
    if (!operatorId) return null;
    // 관리자는 정지할 수 없다. 정지된 주선자를 관리자로 지정했다면 정지가 풀린다.
    await sql.query(`DELETE FROM user_suspensions WHERE user_id = $1`, [operatorId]);

    const owned = await sql.query<{ group_id: string }>(
      `SELECT group_id FROM group_admins WHERE user_id = $1 AND is_owner`,
      [operatorId],
    );
    for (const { group_id: groupId } of owned.rows) {
      // 모임장 하나만 허용하는 부분 유니크 인덱스 때문에 해제한 뒤 부여한다.
      await sql.query(
        `UPDATE group_admins SET is_owner = false WHERE group_id = $1 AND user_id = $2`,
        [groupId, operatorId],
      );
      await sql.query(
        `UPDATE group_admins SET is_owner = true
          WHERE group_id = $1
            AND user_id = (SELECT user_id FROM group_admins
                            WHERE group_id = $1 AND user_id <> $2
                            ORDER BY added_at LIMIT 1)`,
        [groupId, operatorId],
      );
    }
    await sql.query(`DELETE FROM group_admins WHERE user_id = $1`, [operatorId]);
    return operatorId;
  });
}

/** 이 사용자가 관리자인가. owner 커넥션 경로(모임 설정·소속)에서 쓴다. */
export async function isOperatorUser(sql: Sql, userId: string): Promise<boolean> {
  const result = await sql.query(
    `SELECT 1 FROM operator_settings WHERE operator_user_id = $1`,
    [userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export type OperatorSettings = {
  /** 켜져 있으면 주선자의 모임 만들기가 관리자 승인을 기다린다. */
  groupCreationRequiresApproval: boolean;
  /** 켜져 있으면 새로 발급한 모임 초대 코드를 만료 전까지 여러 명이 쓴다. 끄면 1회용. */
  groupInviteReusable: boolean;
  updatedAt: Date;
};

type SettingsRow = {
  group_creation_requires_approval: boolean;
  group_invite_reusable: boolean;
  updated_at: Date;
};

const SETTINGS_COLUMNS = `group_creation_requires_approval, group_invite_reusable, updated_at`;

function toSettings(row: SettingsRow | undefined): OperatorSettings {
  // 한 줄은 마이그레이션이 넣어 둔다. 없으면 승인 없이·1회용으로 도는 기본값으로 본다.
  return {
    groupCreationRequiresApproval: row?.group_creation_requires_approval ?? false,
    groupInviteReusable: row?.group_invite_reusable ?? false,
    updatedAt: row?.updated_at ?? new Date(0),
  };
}

export async function readOperatorSettings(): Promise<OperatorSettings> {
  return withOwner(async (sql) => {
    const result = await sql.query<SettingsRow>(
      `SELECT ${SETTINGS_COLUMNS} FROM operator_settings`,
    );
    return toSettings(result.rows[0]);
  });
}

/** 보낸 항목만 바꾼다. 바뀐 항목마다 감사 기록을 하나씩 남긴다. */
export async function updateOperatorSettings(input: {
  operatorId: string;
  groupCreationRequiresApproval?: boolean;
  groupInviteReusable?: boolean;
}): Promise<OperatorSettings> {
  return withOwnerTx(async (sql) => {
    await sql.query(`INSERT INTO operator_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING`);
    const result = await sql.query<SettingsRow>(
      `UPDATE operator_settings
          SET group_creation_requires_approval = COALESCE($1, group_creation_requires_approval),
              group_invite_reusable = COALESCE($2, group_invite_reusable),
              updated_by = $3
        RETURNING ${SETTINGS_COLUMNS}`,
      [
        input.groupCreationRequiresApproval ?? null,
        input.groupInviteReusable ?? null,
        input.operatorId,
      ],
    );
    if (input.groupCreationRequiresApproval !== undefined) {
      await writeAudit(sql, {
        actorUserId: input.operatorId,
        action: "operator.group_approval.set",
        entityType: "operator_settings",
        metadata: { enabled: input.groupCreationRequiresApproval },
      });
    }
    if (input.groupInviteReusable !== undefined) {
      await writeAudit(sql, {
        actorUserId: input.operatorId,
        action: "operator.group_invite_reusable.set",
        entityType: "operator_settings",
        metadata: { enabled: input.groupInviteReusable },
      });
    }
    return toSettings(result.rows[0]);
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

export type HostRow = {
  userId: string;
  displayName: string | null;
  email: string | null;
  /** 계정 설정에서 올린 사진의 저장 키. 화면에 내보낼 때 signed URL 로 바꾼다. */
  avatarKey: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  isOperator: boolean;
  /** 속한 모임 이름. 가입 순. */
  groups: string[];
  /** 이 주선자가 등록한 프로필 — 지금 공개 중인 수와 전체 수. */
  activeProfiles: number;
  totalProfiles: number;
  telegramConnected: boolean;
  suspension: { at: Date; reason: string | null; byName: string | null } | null;
};

/** `pnpm dev:session` 이 만드는 점검 계정. 실제 주선자가 아니라 목록에서 뺀다. */
const DEV_CHECK_EMAIL = "dev-check@bolsaram.local";

/**
 * 관리자 화면의 주선자 목록 — 정지된 사람을 위로, 그다음은 최근 가입 순.
 *
 * 이메일을 싣는다. 관리자가 사람을 알아보는 유일한 단서이고, 관리자 화면 밖으로는
 * 나가지 않는다. 점검 계정은 싣지 않는다.
 */
export async function listHosts(): Promise<HostRow[]> {
  return withOwner(async (sql) => {
    const result = await sql.query<{
      id: string;
      display_name: string | null;
      email: string | null;
      avatar_key: string | null;
      created_at: Date;
      last_login_at: Date | null;
      is_operator: boolean;
      groups: string[];
      active_profiles: number;
      total_profiles: number;
      telegram_connected: boolean;
      suspended_at: Date | null;
      suspend_reason: string | null;
      suspended_by_name: string | null;
    }>(
      `SELECT u.id, u.display_name, u.email::text AS email, u.avatar_key, u.created_at, u.last_login_at,
              EXISTS (SELECT 1 FROM operator_settings os WHERE os.operator_user_id = u.id)
                AS is_operator,
              COALESCE((SELECT array_agg(g.name ORDER BY ga.added_at)
                          FROM group_admins ga JOIN groups g ON g.id = ga.group_id
                         WHERE ga.user_id = u.id), '{}') AS groups,
              (SELECT count(*)::int FROM profiles p
                WHERE p.created_by = u.id AND p.status = 'ACTIVE') AS active_profiles,
              (SELECT count(*)::int FROM profiles p WHERE p.created_by = u.id) AS total_profiles,
              EXISTS (SELECT 1 FROM telegram_connections tc WHERE tc.user_id = u.id)
                AS telegram_connected,
              us.created_at AS suspended_at, us.reason AS suspend_reason,
              sb.display_name AS suspended_by_name
         FROM users u
         LEFT JOIN user_suspensions us ON us.user_id = u.id
         LEFT JOIN users sb ON sb.id = us.suspended_by
        WHERE u.role = 'ADMIN' AND u.email IS DISTINCT FROM $1::citext
        ORDER BY (us.user_id IS NOT NULL) DESC, u.created_at DESC`,
      [DEV_CHECK_EMAIL],
    );
    return result.rows.map((row) => ({
      userId: row.id,
      displayName: row.display_name,
      email: row.email,
      avatarKey: row.avatar_key,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      isOperator: row.is_operator,
      groups: row.groups,
      activeProfiles: row.active_profiles,
      totalProfiles: row.total_profiles,
      telegramConnected: row.telegram_connected,
      suspension: row.suspended_at
        ? { at: row.suspended_at, reason: row.suspend_reason, byName: row.suspended_by_name }
        : null,
    }));
  });
}

/**
 * 주선자를 정지한다. 한 트랜잭션에서 그 사람이 남긴 흔적의 효력을 함께 끊는다.
 *
 *   - 세션을 모두 폐기한다 — 정지는 다음 요청부터가 아니라 **지금** 걸린다.
 *   - 등록한 프로필 중 공개 중인 것을 비활성으로 돌린다. 담당자가 신청을 처리할 수
 *     없게 된 프로필을 계속 보여주지 않는다(모임 나가기와 같은 규칙, 0056).
 *     정지를 풀어도 되살리지 않는다 — 주선자가 직접 다시 공개한다.
 *   - 기다리는 모임 만들기 요청은 거절로 닫는다.
 *   - 그 사람이 발급한 살아 있는 모임 초대 코드를 거둔다.
 *
 * 모임 소속과 텔레그램 연결은 남긴다 — 정지를 풀면 그대로 돌아온다. 그동안 봇과
 * 알림은 인증 레이어가 막는다.
 */
export async function suspendHost(input: {
  operatorId: string;
  userId: string;
  reason?: string | undefined;
}): Promise<{ deactivatedProfiles: number }> {
  if (input.userId === input.operatorId) {
    throw new DomainError("CONFLICT", "자기 자신은 정지할 수 없습니다.");
  }
  return withOwnerTx(async (sql) => {
    const target = await sql.query<{ role: string }>(
      `SELECT role FROM users WHERE id = $1 FOR UPDATE`,
      [input.userId],
    );
    if (target.rows[0]?.role !== "ADMIN") {
      throw new DomainError("NOT_FOUND", "주선자 계정을 찾지 못했습니다.");
    }
    if (await isOperatorUser(sql, input.userId)) {
      throw new DomainError("CONFLICT", "관리자는 정지할 수 없습니다.");
    }
    const inserted = await sql.query(
      `INSERT INTO user_suspensions (user_id, suspended_by, reason)
       VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`,
      [input.userId, input.operatorId, input.reason?.trim() || null],
    );
    if ((inserted.rowCount ?? 0) === 0) {
      throw new DomainError("CONFLICT", "이미 정지된 주선자입니다.");
    }

    await sql.query(
      `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [input.userId],
    );
    const deactivated = await sql.query(
      `UPDATE profiles SET status = 'INACTIVE' WHERE created_by = $1 AND status = 'ACTIVE'`,
      [input.userId],
    );
    await sql.query(
      `UPDATE group_creation_requests
          SET status = 'REJECTED', decided_at = now(), decided_by = $2
        WHERE requested_by = $1 AND status = 'PENDING'`,
      [input.userId, input.operatorId],
    );
    await sql.query(
      `DELETE FROM group_invite_codes WHERE created_by = $1 AND consumed_at IS NULL`,
      [input.userId],
    );
    await sql.query(
      `UPDATE group_invite_codes SET expires_at = now()
        WHERE created_by = $1 AND expires_at > now()`,
      [input.userId],
    );

    const deactivatedProfiles = deactivated.rowCount ?? 0;
    await writeAudit(sql, {
      actorUserId: input.operatorId,
      action: "operator.host.suspend",
      entityType: "user",
      entityId: input.userId,
      metadata: { deactivatedProfiles },
    });
    return { deactivatedProfiles };
  });
}

/** 정지를 푼다. 비활성으로 돌린 프로필은 그대로 둔다 — 주선자가 다시 공개한다. */
export async function unsuspendHost(input: { operatorId: string; userId: string }): Promise<void> {
  await withOwnerTx(async (sql) => {
    const deleted = await sql.query(`DELETE FROM user_suspensions WHERE user_id = $1`, [
      input.userId,
    ]);
    if ((deleted.rowCount ?? 0) === 0) {
      throw new DomainError("NOT_FOUND", "정지된 주선자가 아닙니다.");
    }
    await writeAudit(sql, {
      actorUserId: input.operatorId,
      action: "operator.host.unsuspend",
      entityType: "user",
      entityId: input.userId,
    });
  });
}
