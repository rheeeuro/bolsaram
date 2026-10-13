/**
 * 모임 — 소속·초대 코드·활성 채널.
 *
 * 한 주선자가 **여러 모임에 동시에 속한다.** 카카오톡 단톡방이나 디스코드 채널처럼
 * 목록에서 하나를 골라 그 안에서 일하고, 언제든 다른 모임으로 옮겨 간다. 지금 어느
 * 모임을 보고 있는지는 `users.active_group_id` 에 있고(0036) 소속이 아닌 것을 가리키면
 * 전체공개로 떨어진다.
 *
 * 초대 코드는 `invites`(멤버 초대)·`telegram_link_codes` 와 같은 방식이다 — 평문을
 * 저장하지 않고 pepper 를 섞은 해시만 남기며, 소비는 조건부 UPDATE 로 한 번만
 * 성공한다(replay 차단). 관리자가 「여러 번 쓰기」를 켜 두면 그때 발급한 코드는
 * 만료 전까지 여러 명이 쓴다(0066).
 *
 * owner 커넥션을 쓰는 이유: 모임 소속은 데이터가 아니라 **신원**에 가깝다.
 * `group_admins` 에 INSERT 정책을 주지 않았으므로 이 경로만이 소속을 바꿀 수 있다.
 * 활성 채널(`users.active_group_id`)도 앱 롤의 UPDATE 권한에서 빼 두었다.
 */
import "server-only";
import { withOwner, withOwnerTx, type Sql } from "@bolsaram/db";
import { DomainError } from "@bolsaram/domain";
import { MAX_GROUPS_PER_ADMIN, type GroupChatNotifyMode } from "@bolsaram/schemas";
import { env } from "../env";
import { writeAudit } from "../audit";
import { isOperatorUser, readOperatorSettings } from "./operator";
import { peppered, randomToken } from "../crypto";

/**
 * 모임 수 상한을 지킨다. 넘으면 던진다.
 *
 * **만들기와 합류가 같은 문을 지난다** — 한쪽만 막으면 초대 코드로 넘어간다.
 * 승인을 기다리는 모임 만들기 요청도 한 자리로 센다 — 대기 중에 상한을 넘겨 두면
 * 승인하는 순간 거절된다.
 *
 * 세기 전에 `users` 행을 잠가 둔다: 같은 계정으로 두 요청이 동시에 들어와도
 * 한쪽이 끝난 뒤에 세므로 상한을 한 칸 넘겨 통과하는 일이 없다.
 */
export async function assertGroupCapacity(
  sql: Sql,
  userId: string,
  message = `모임은 최대 ${MAX_GROUPS_PER_ADMIN}개까지입니다. 쓰지 않는 모임에서 나간 뒤 다시 시도하세요.`,
): Promise<void> {
  await sql.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [userId]);
  const counted = await sql.query<{ count: number }>(
    `SELECT (SELECT count(*) FROM group_admins WHERE user_id = $1)
          + (SELECT count(*) FROM group_creation_requests
              WHERE requested_by = $1 AND status = 'PENDING') AS count`,
    [userId],
  );
  if (Number(counted.rows[0]?.count ?? 0) >= MAX_GROUPS_PER_ADMIN) {
    throw new DomainError("CONFLICT", message);
  }
}

/**
 * 모임 행과 모임장 소속을 함께 만든다. 상한은 호출부가 먼저 본다.
 *
 * 바로 만들기와 관리자 승인이 같은 모양의 모임을 만들도록 한 곳에 둔다.
 */
export async function insertGroupWithOwner(
  sql: Sql,
  input: { userId: string; name: string; description: string | null },
): Promise<string> {
  const group = await sql.query<{ id: string }>(
    `INSERT INTO groups (name, description, created_by) VALUES ($1, $2, $3) RETURNING id`,
    [input.name, input.description, input.userId],
  );
  const groupId = group.rows[0]!.id;
  await sql.query(
    `INSERT INTO group_admins (group_id, user_id, is_owner, added_by)
     VALUES ($1, $2, true, $2)`,
    [groupId, input.userId],
  );
  return groupId;
}

/**
 * 이미 있는 주선자 계정에 모임을 만들어 준다.
 *
 * 가입은 계정만 만들므로 모임이 필요하면 여기를 지난다. 한 주선자가 여러 모임에서
 * 일하고 화면에서 채널처럼 오가되(0036) 동시에 속하는 수는 `MAX_GROUPS_PER_ADMIN`
 * 까지다. 만든 모임을 바로 활성 채널로 만들어 준다.
 *
 * `groups` INSERT 정책을 앱 롤에 주지 않았으므로 owner 커넥션으로만 가능하다 —
 * 모임 소속은 데이터가 아니라 신원에 가깝다는 판단이다.
 */
export async function createGroupForAdmin(input: {
  userId: string;
  name: string;
  description?: string;
}): Promise<{ groupId: string }> {
  return withOwnerTx(async (sql) => {
    const description = input.description?.trim() || null;
    // 관리자는 모임에 속하지 않는다(0065). 모임만 만들고, 모임장은 나중에 합류한
    // 주선자에게 모임 설정에서 넘긴다. 속하지 않으니 상한도 없다.
    if (await isOperatorUser(sql, input.userId)) {
      const group = await sql.query<{ id: string }>(
        `INSERT INTO groups (name, description, created_by) VALUES ($1, $2, $3) RETURNING id`,
        [input.name, description, input.userId],
      );
      const groupId = group.rows[0]!.id;
      await sql.query(`UPDATE users SET active_group_id = $2 WHERE id = $1`, [
        input.userId,
        groupId,
      ]);
      return { groupId };
    }
    await assertGroupCapacity(sql, input.userId);
    const groupId = await insertGroupWithOwner(sql, {
      userId: input.userId,
      name: input.name,
      description,
    });
    // 방금 만든 모임을 보고 있게 한다 — 만들자마자 그 안에서 일할 것이다.
    await sql.query(`UPDATE users SET active_group_id = $2 WHERE id = $1`, [
      input.userId,
      groupId,
    ]);
    return { groupId };
  });
}

export type GroupCreationResult =
  | { status: "CREATED"; groupId: string }
  | { status: "PENDING"; requestId: string };

/**
 * 「모임 만들기」. 관리자가 승인을 켜 두었으면 모임 대신 요청을 남긴다.
 *
 * 승인 여부는 요청이 들어온 순간의 설정으로 정한다 — 화면이 열린 뒤 관리자가 설정을
 * 바꿨어도 서버가 판정한 결과를 돌려주므로 화면은 그대로 따르면 된다.
 * 관리자 본인은 승인할 사람이 자기라서 기다리지 않고 바로 만든다.
 */
export async function requestGroupCreation(input: {
  userId: string;
  isOperator: boolean;
  name: string;
  description?: string;
}): Promise<GroupCreationResult> {
  if (input.isOperator || !(await readOperatorSettings()).groupCreationRequiresApproval) {
    const created = await createGroupForAdmin(input);
    return { status: "CREATED", groupId: created.groupId };
  }
  return withOwnerTx(async (sql) => {
    await assertGroupCapacity(sql, input.userId);
    const inserted = await sql.query<{ id: string }>(
      `INSERT INTO group_creation_requests (requested_by, name, description)
       VALUES ($1, $2, $3) RETURNING id`,
      [input.userId, input.name, input.description?.trim() || null],
    );
    return { status: "PENDING", requestId: inserted.rows[0]!.id };
  });
}

export type MyGroupRequest = {
  requestId: string;
  name: string;
  status: "PENDING" | "REJECTED";
  createdAt: Date;
};

/** 승인되지 않은 요청을 이만큼 보여주고 접는다. 그 뒤에는 다시 요청하면 된다. */
const REJECTED_VISIBLE_DAYS = 7;

/**
 * 내 모임 만들기 요청 — 기다리는 것과 최근에 승인되지 않은 것.
 *
 * 승인된 요청은 모임 목록에 모임으로 나타나므로 여기서 빼고, 거절은 며칠만 남겨
 * 「왜 모임이 안 생겼는지」를 알 수 있게 한다.
 */
export async function readMyGroupRequests(userId: string): Promise<MyGroupRequest[]> {
  return withOwner(async (sql) => {
    const result = await sql.query<{
      id: string;
      name: string;
      status: "PENDING" | "REJECTED";
      created_at: Date;
    }>(
      `SELECT id, name, status, created_at
         FROM group_creation_requests
        WHERE requested_by = $1
          AND (status = 'PENDING'
               OR (status = 'REJECTED'
                   AND decided_at > now() - make_interval(days => $2)))
        ORDER BY created_at`,
      [userId, REJECTED_VISIBLE_DAYS],
    );
    return result.rows.map((row) => ({
      requestId: row.id,
      name: row.name,
      status: row.status,
      createdAt: row.created_at,
    }));
  });
}

/** 기다리는 내 요청을 거둔다. 이미 결정된 것은 건드리지 않는다. */
export async function cancelGroupCreationRequest(input: {
  userId: string;
  requestId: string;
}): Promise<void> {
  const result = await withOwner((sql) =>
    sql.query(
      `UPDATE group_creation_requests
          SET status = 'CANCELED', decided_at = now(), decided_by = $2
        WHERE id = $1 AND requested_by = $2 AND status = 'PENDING'`,
      [input.requestId, input.userId],
    ),
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new DomainError("NOT_FOUND", "기다리는 요청이 아닙니다. 화면을 새로 고쳐 주세요.");
  }
}

/**
 * 관리자가 기다리는 요청을 승인하거나 거절한다. 호출부가 관리자인지 먼저 확인한다.
 *
 * 승인은 그 순간에 모임을 만들고 요청한 사람을 모임장으로 둔다. 요청 행을 먼저
 * 조건부로 닫아 두 번 눌러도 모임이 둘 생기지 않게 하고, 그 뒤에 상한을 센다 —
 * 닫힌 요청은 더 이상 자리를 차지하지 않으므로 자기 자신에게 막히지 않는다.
 * 보고 있는 모임은 바꾸지 않는다. 요청한 사람은 다른 일을 하는 중일 수 있다.
 */
export async function decideGroupCreationRequest(input: {
  requestId: string;
  operatorId: string;
  approve: boolean;
}): Promise<{ groupId: string | null }> {
  return withOwnerTx(async (sql) => {
    const closed = await sql.query<{
      requested_by: string;
      name: string;
      description: string | null;
    }>(
      `UPDATE group_creation_requests
          SET status = $3, decided_by = $2, decided_at = now()
        WHERE id = $1 AND status = 'PENDING'
        RETURNING requested_by, name, description`,
      [input.requestId, input.operatorId, input.approve ? "APPROVED" : "REJECTED"],
    );
    const request = closed.rows[0];
    if (!request) {
      throw new DomainError("CONFLICT", "이미 처리했거나 거둬진 요청입니다.");
    }

    let groupId: string | null = null;
    if (input.approve) {
      await assertGroupCapacity(
        sql,
        request.requested_by,
        `요청한 주선자가 이미 모임 ${MAX_GROUPS_PER_ADMIN}개에 속해 있어 만들 수 없습니다.`,
      );
      groupId = await insertGroupWithOwner(sql, {
        userId: request.requested_by,
        name: request.name,
        description: request.description,
      });
      await sql.query(`UPDATE group_creation_requests SET group_id = $2 WHERE id = $1`, [
        input.requestId,
        groupId,
      ]);
    }

    await writeAudit(sql, {
      actorUserId: input.operatorId,
      action: input.approve ? "group_request.approve" : "group_request.reject",
      entityType: "group_creation_request",
      entityId: input.requestId,
      metadata: groupId ? { groupId } : {},
    });
    return { groupId };
  });
}

/** 초대 코드 유효시간. 멤버 초대(72시간)보다 짧게 둔다 — 주선자 권한이 더 세다. */
export const GROUP_INVITE_TTL_HOURS = 24;

function hashCode(code: string): string {
  return peppered(env().INVITE_TOKEN_PEPPER, `group-invite:${code}`);
}

/**
 * 이 사용자가 그 모임의 주선자인지 확인한다. 아니면 던진다.
 *
 * RLS 도 같은 판정을 하지만(`app_is_group_admin`) 모임 설정·초대 코드 경로는 owner
 * 커넥션으로 돌기 때문에 정책이 걸리지 않는다. 그래서 여기서 막는 것이 유일한 방어가
 * 아니라 **애플리케이션 레이어의 몫 전체**다. 관리자도 여기를 통과한다.
 */
export async function assertGroupAdmin(userId: string, groupId: string): Promise<void> {
  // 관리자는 소속 없이 모든 모임을 다룬다(0065) — 모임이 있기만 하면 통과한다.
  const result = await withOwner((sql) =>
    sql.query(
      `SELECT 1 FROM groups g
        WHERE g.id = $2
          AND (EXISTS (SELECT 1 FROM group_admins ga
                        WHERE ga.group_id = g.id AND ga.user_id = $1)
               OR EXISTS (SELECT 1 FROM operator_settings os
                           WHERE os.operator_user_id = $1))`,
      [userId, groupId],
    ),
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new DomainError("FORBIDDEN", "속하지 않은 모임입니다.");
  }
}

/**
 * 보고 있는 모임(채널)을 바꾼다. `null` 이면 전체공개다.
 *
 * 권한을 주는 동작이 아니다 — 어느 모임을 볼 수 있는지는 RLS 가 `group_admins` 로
 * 판정하며, 여기서 무엇을 넣든 그 범위는 달라지지 않는다. 그래도 속하지 않은 모임을
 * 활성 채널로 두면 화면이 조용히 비어 보이므로 소속을 확인하고 넣는다.
 */
export async function setActiveGroup(userId: string, groupId: string | null): Promise<void> {
  if (groupId) await assertGroupAdmin(userId, groupId);
  await withOwner((sql) =>
    sql.query(`UPDATE users SET active_group_id = $2 WHERE id = $1`, [userId, groupId]),
  );
}

export type IssuedGroupInvite = {
  /** 평문 코드. 이 순간 이후 다시 조회할 수 없다. 로그에 남기지 않는다. */
  code: string;
  expiresAt: Date;
  /** 만료 전까지 여러 명이 쓸 수 있는가. 발급할 때의 관리자 설정을 따른다. */
  reusable: boolean;
};

/**
 * 모임에 속한 주선자만 발급할 수 있다(호출부가 `assertGroupAdmin` 으로 확인한다).
 *
 * 1회용인지 여러 번 쓰는지는 지금 관리자 설정을 코드에 적어 둔다.
 */
export async function issueGroupInvite(input: {
  groupId: string;
  createdBy: string;
}): Promise<IssuedGroupInvite> {
  const code = randomToken(16);
  const expiresAt = new Date(Date.now() + GROUP_INVITE_TTL_HOURS * 3_600_000);

  const reusable = await withOwnerTx(async (sql) => {
    // 내가 만든 살아 있는 코드는 거둔다. 살아 있는 코드가 여러 개면 회수가 어렵다.
    // 아직 안 쓴 것은 지우고, 이미 쓰였지만 여러 번 쓰는 것은 기록을 남긴 채 만료시킨다.
    await sql.query(
      `DELETE FROM group_invite_codes
        WHERE group_id = $1 AND created_by = $2 AND consumed_at IS NULL`,
      [input.groupId, input.createdBy],
    );
    await sql.query(
      `UPDATE group_invite_codes SET expires_at = now()
        WHERE group_id = $1 AND created_by = $2 AND reusable AND expires_at > now()`,
      [input.groupId, input.createdBy],
    );
    const inserted = await sql.query<{ reusable: boolean }>(
      `INSERT INTO group_invite_codes (code_hash, group_id, created_by, expires_at, reusable)
       VALUES ($1, $2, $3, $4,
               COALESCE((SELECT group_invite_reusable FROM operator_settings), false))
       RETURNING reusable`,
      [hashCode(code), input.groupId, input.createdBy, expiresAt],
    );
    return inserted.rows[0]!.reusable;
  });

  return { code, expiresAt, reusable };
}

/**
 * 코드를 소비하고 그 모임에 합류한다. 이미 속한 모임이 있어도 상관없다 —
 * 여러 모임에 동시에 속할 수 있다. 합류한 모임을 바로 활성 채널로 만든다.
 *
 * 1회용 코드는 처음 한 번만 통과한다. 여러 번 쓰는 코드는 만료 전까지 통과하지만
 * **지금도 관리자 설정이 켜져 있을 때만**이다 — 끄면 이미 쓰인 코드는 그 순간 막힌다.
 *
 * 상한은 **새로 들어갈 때만** 본다. 이미 속한 모임의 코드를 다시 넣으면 소속이
 * 늘지 않으므로 상한에 걸릴 이유가 없다.
 */
export async function consumeGroupInvite(input: {
  code: string;
  userId: string;
}): Promise<{ groupId: string }> {
  return withOwnerTx(async (sql) => {
    // 코드를 쓰기 전에 거른다 — 관리자가 눌러 봤다고 동료의 코드가 사라지면 안 된다.
    if (await isOperatorUser(sql, input.userId)) {
      throw new DomainError(
        "CONFLICT",
        "관리자는 초대 코드 없이 모든 모임에 들어갑니다. 위쪽 모임 목록에서 고르세요.",
      );
    }
    const claimed = await sql.query<{ group_id: string }>(
      `UPDATE group_invite_codes
          SET consumed_at = now(), consumed_by = $2, use_count = use_count + 1
        WHERE code_hash = $1
          AND expires_at > now()
          AND (consumed_at IS NULL
               OR (reusable AND COALESCE(
                     (SELECT group_invite_reusable FROM operator_settings), false)))
        RETURNING group_id`,
      [hashCode(input.code), input.userId],
    );
    const row = claimed.rows[0];
    if (!row) {
      throw new DomainError("NOT_FOUND", "만료되었거나 이미 사용된 초대 코드입니다.");
    }

    // 이미 그 모임에 있으면 코드만 소비되고 소속은 그대로다. 실수로 두 번 넣어도
    // 오류 대신 그 모임으로 옮겨 주는 편이 낫다.
    const already = await sql.query(
      `SELECT 1 FROM group_admins WHERE group_id = $1 AND user_id = $2`,
      [row.group_id, input.userId],
    );
    if ((already.rowCount ?? 0) === 0) {
      await assertGroupCapacity(sql, input.userId);
      // 합류하는 사람은 OWNER 가 아니다.
      await sql.query(
        `INSERT INTO group_admins (group_id, user_id, is_owner, added_by)
         VALUES ($1, $2, false, (SELECT created_by FROM group_invite_codes WHERE code_hash = $3))`,
        [row.group_id, input.userId, hashCode(input.code)],
      );
    }

    await sql.query(`UPDATE users SET active_group_id = $2 WHERE id = $1`, [
      input.userId,
      row.group_id,
    ]);
    return { groupId: row.group_id };
  });
}

export type GroupSummary = {
  groupId: string;
  name: string;
  /** 주선자들끼리 보는 메모. 멤버에게는 노출하지 않는다. */
  description: string | null;
  /** 모임 사진의 저장 키. 없으면 화면이 모임 이름의 앞글자를 그린다. */
  imageKey: string | null;
  isOwner: boolean;
  /**
   * 소속이 아니라 관리자로서 보고 있다. 모임장과 같은 권한이지만 나가기는 없다 —
   * 애초에 속하지 않았다(0065).
   */
  asOperator: boolean;
  /** 이 모임에 등록된 멤버 수. 목록에서 어느 방이 활발한지 가늠하는 데 쓴다. */
  memberCount: number;
  /** 이 모임으로 가져온 Import 건수. 폐쇄를 막는 것이 무엇인지 화면에 적을 때 쓴다. */
  importCount: number;
  /** 내가 이 모임에 등록한 활성 프로필 수. 나가면 모두 비활성이 된다(0056). */
  myActiveCount: number;
  admins: { userId: string; displayName: string | null; isOwner: boolean }[];
  /** 이 방의 채팅 텔레그램 알림(0068). 사람마다 따로 고르고, 기본은 멘션만이다. */
  chatNotify: GroupChatNotifyMode;
  /** 텔레그램을 연결했는가. 연결해야 채팅 알림을 고를 수 있다. 모임과 상관없이 같다. */
  telegramLinked: boolean;
};

/**
 * 내가 속한 모임 전부. 들어간 순서대로 준다.
 *
 * 주선자 화면의 채널 목록이자 모임 설정 화면의 내용이다. 모임이 하나도 없는 것도
 * 정상이다(가입 직후) — 그때는 전체공개 채널만 쓴다.
 */
export async function readMyGroups(userId: string): Promise<GroupSummary[]> {
  return withOwner(async (sql) => {
    const operator = await isOperatorUser(sql, userId);
    const groups = await sql.query<{
      group_id: string;
      name: string;
      description: string | null;
      image_key: string | null;
      is_owner: boolean;
      member_count: number;
      import_count: number;
      my_active_count: number;
      chat_notify: GroupChatNotifyMode;
      telegram_linked: boolean;
    }>(
      // 관리자는 소속이 없으므로 모임 전부를 만든 순서대로 준다.
      `SELECT g.id AS group_id, g.name, g.description, g.image_key,
              COALESCE(ga.is_owner, false) AS is_owner,
              (SELECT count(*)::int FROM profiles p WHERE p.group_id = g.id) AS member_count,
              (SELECT count(*)::int FROM import_sessions i WHERE i.group_id = g.id) AS import_count,
              (SELECT count(*)::int FROM profiles p
                WHERE p.group_id = g.id AND p.created_by = $1
                  AND p.status = 'ACTIVE') AS my_active_count,
              COALESCE(pref.notify, 'MENTIONS') AS chat_notify,
              EXISTS (SELECT 1 FROM telegram_connections tc WHERE tc.user_id = $1)
                AS telegram_linked
         FROM groups g
         LEFT JOIN group_admins ga ON ga.group_id = g.id AND ga.user_id = $1
         LEFT JOIN group_chat_prefs pref
           ON pref.group_id = g.id AND pref.user_id = $1
        WHERE $2::boolean OR ga.user_id IS NOT NULL
        ORDER BY ga.added_at NULLS LAST, g.created_at`,
      [userId, operator],
    );
    if (groups.rowCount === 0) return [];

    const admins = await sql.query<{
      group_id: string;
      user_id: string;
      display_name: string | null;
      is_owner: boolean;
    }>(
      `SELECT ga.group_id, ga.user_id, u.display_name, ga.is_owner
         FROM group_admins ga JOIN users u ON u.id = ga.user_id
        WHERE ga.group_id = ANY($1) ORDER BY ga.added_at`,
      [groups.rows.map((g) => g.group_id)],
    );

    return groups.rows.map((group) => ({
      groupId: group.group_id,
      name: group.name,
      description: group.description,
      imageKey: group.image_key,
      isOwner: group.is_owner,
      asOperator: operator,
      memberCount: group.member_count,
      importCount: group.import_count,
      myActiveCount: group.my_active_count,
      chatNotify: group.chat_notify,
      telegramLinked: group.telegram_linked,
      admins: admins.rows
        .filter((a) => a.group_id === group.group_id)
        .map((a) => ({
          userId: a.user_id,
          displayName: a.display_name,
          isOwner: a.is_owner,
        })),
    }));
  });
}

/**
 * 모임 이름·설명을 고친다. 보낸 필드만 바꾼다.
 *
 * 같은 모임의 주선자면 누구나 고칠 수 있다 — 한 팀으로 일하는 사이라 모임장만으로
 * 좁히면 모임장이 없을 때 아무도 못 고친다. RLS(`groups_owner_update`)도 같은 판정이다.
 */
export async function updateGroup(input: {
  groupId: string;
  name?: string;
  description?: string;
}): Promise<void> {
  const result = await withOwner((sql) =>
    sql.query(
      `UPDATE groups
          SET name = COALESCE($2, name),
              description = CASE WHEN $3::text IS NULL THEN description
                                 WHEN btrim($3) = '' THEN NULL
                                 ELSE btrim($3) END
        WHERE id = $1`,
      [input.groupId, input.name ?? null, input.description ?? null],
    ),
  );
  if (result.rowCount === 0) {
    throw new DomainError("NOT_FOUND", "모임을 찾을 수 없습니다.");
  }
}

/**
 * 모임 사진을 바꾸거나(`imageKey`) 지운다(`null`).
 *
 * 이름·설명과 같은 취급이다 — 그 모임의 주선자면 누구나 바꾼다. 밀려난 사진의 저장
 * 키를 돌려주므로 호출부가 실제 파일도 지운다.
 */
export async function updateGroupImage(input: {
  groupId: string;
  imageKey: string | null;
}): Promise<{ previousKey: string | null }> {
  const result = await withOwner((sql) =>
    sql.query<{ previous_key: string | null }>(
      `UPDATE groups AS g SET image_key = $2
         FROM (SELECT image_key FROM groups WHERE id = $1) AS old
        WHERE g.id = $1
        RETURNING old.image_key AS previous_key`,
      [input.groupId, input.imageKey],
    ),
  );
  const row = result.rows[0];
  if (!row) throw new DomainError("NOT_FOUND", "모임을 찾을 수 없습니다.");
  return { previousKey: row.previous_key };
}

/**
 * 이 사용자가 그 모임의 **모임장**인지 확인한다. 아니면 던진다.
 *
 * 소속(`assertGroupAdmin`)보다 한 칸 좁다. 다른 주선자의 소속을 건드리는 동작에만
 * 쓴다 — 이름·설명 수정과 초대 코드 발급은 지금까지대로 소속 주선자 누구나 한다.
 */
export async function assertGroupOwner(userId: string, groupId: string): Promise<void> {
  // 관리자는 모든 모임에서 모임장과 같은 일을 한다(0065).
  const result = await withOwner((sql) =>
    sql.query(
      `SELECT 1 FROM groups g
        WHERE g.id = $2
          AND (EXISTS (SELECT 1 FROM group_admins ga
                        WHERE ga.group_id = g.id AND ga.user_id = $1 AND ga.is_owner)
               OR EXISTS (SELECT 1 FROM operator_settings os
                           WHERE os.operator_user_id = $1))`,
      [userId, groupId],
    ),
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new DomainError("FORBIDDEN", "모임장만 할 수 있습니다.");
  }
}

/**
 * 모임장을 다른 주선자에게 넘긴다.
 *
 * 넘기고 나면 자기는 보통 주선자가 된다 — 되돌리려면 새 모임장이 다시 넘겨야 한다.
 * 한 트랜잭션 안에서 **해제한 뒤 부여한다**: `group_admins_one_owner` 가 모임당
 * 모임장 하나만 허용하는 부분 유니크 인덱스라 순서를 바꾸면 충돌한다.
 */
export async function transferGroupOwnership(input: {
  actorId: string;
  groupId: string;
  targetUserId: string;
}): Promise<void> {
  if (input.actorId === input.targetUserId) {
    throw new DomainError("CONFLICT", "이미 모임장입니다.");
  }
  await assertGroupOwner(input.actorId, input.groupId);

  await withOwnerTx(async (sql) => {
    const target = await sql.query(
      `SELECT 1 FROM group_admins WHERE group_id = $1 AND user_id = $2`,
      [input.groupId, input.targetUserId],
    );
    if ((target.rowCount ?? 0) === 0) {
      throw new DomainError("NOT_FOUND", "이 모임의 주선자가 아닙니다.");
    }

    // 지금 모임장을 해제한다. 넘기는 사람이 모임장이면 자기 자신이고, 관리자가 넘기면
    // 그 모임의 모임장(없을 수도 있다)이다.
    await sql.query(
      `UPDATE group_admins SET is_owner = false
        WHERE group_id = $1 AND is_owner AND user_id <> $2`,
      [input.groupId, input.targetUserId],
    );
    await sql.query(
      `UPDATE group_admins SET is_owner = true WHERE group_id = $1 AND user_id = $2`,
      [input.groupId, input.targetUserId],
    );
  });
}

/**
 * 다른 주선자를 모임에서 내보낸다. 모임장만 할 수 있다.
 *
 * 나가는 것(`leaveGroup`)과 결과는 같지만 **부르는 사람이 다르다.** 초대 코드가 잘못
 * 전달됐을 때 되돌릴 수 있는 유일한 경로다 — 소속이 사라지면 RLS 가 그 모임의 멤버를
 * 전부 가린다.
 *
 * 자기 자신은 이 경로로 뺄 수 없다. 모임장이 빠지는 것은 나가기이고, 그쪽은 남은
 * 주선자에게 모임장을 넘기거나 빈 모임을 지우는 일까지 함께 한다.
 *
 * 내보내진 사람의 활성 채널·봇 업로드 대상은 트리거가 정리한다(0036·0039).
 * 그 사람이 이 모임에 등록한 프로필도 트리거가 비활성으로 돌린다(0056).
 * 방에는 「내보냈습니다」 한 줄이 남는다(0046) — 트리거가 아래 GUC 로 자진 탈퇴와
 * 가른다.
 */
export async function removeGroupAdmin(input: {
  actorId: string;
  groupId: string;
  targetUserId: string;
}): Promise<void> {
  if (input.actorId === input.targetUserId) {
    throw new DomainError("CONFLICT", "자기 자신은 모임 나가기로 빠집니다.");
  }
  await assertGroupOwner(input.actorId, input.groupId);

  await withOwnerTx(async (sql) => {
    await sql.query(`SELECT set_config('app.group_admin_removed_by', $1, true)`, [input.actorId]);
    const removed = await sql.query<{ is_owner: boolean }>(
      `DELETE FROM group_admins WHERE group_id = $1 AND user_id = $2 RETURNING is_owner`,
      [input.groupId, input.targetUserId],
    );
    if (removed.rowCount === 0) {
      throw new DomainError("NOT_FOUND", "이 모임의 주선자가 아닙니다.");
    }
    // 관리자가 모임장을 내보냈다. 나가기와 같이 가장 먼저 들어온 주선자가 이어받는다.
    if (removed.rows[0]!.is_owner) {
      await sql.query(
        `UPDATE group_admins SET is_owner = true
          WHERE group_id = $1
            AND user_id = (SELECT user_id FROM group_admins
                            WHERE group_id = $1 ORDER BY added_at LIMIT 1)`,
        [input.groupId],
      );
    }
  });
}

/**
 * 모임 하나에서 나간다.
 *
 * 막는 경우가 하나 있다 — **마지막 주선자인데 모임에 멤버나 Import 가 남아 있으면**
 * 나갈 수 없다. 나가면 그 데이터를 아무도 볼 수 없게 되고(RLS 가 전부 막는다) 되돌릴
 * 방법도 없다. 등록된 프로필을 다른 모임으로 옮기는 길은 없으므로, 동료를 먼저
 * 초대하거나 남은 프로필·가져오기를 정리하라고 알려준다.
 *
 * 비어 있는 모임이면 나가면서 모임까지 지운다 — 주인 없는 빈 모임을 남기지 않는다.
 * 모임장이 나가고 다른 주선자가 남으면 가장 먼저 들어온 사람에게 모임장을 넘긴다
 * (`group_admins_one_owner` 때문에 모임장 없는 모임을 만들 수 없다).
 *
 * 나간 모임을 보고 있었다면 활성 채널은 남아 있는 다른 모임으로 옮기고, 없으면
 * 전체공개가 된다.
 *
 * 내가 이 모임에 등록한 프로필은 비활성이 된다 — 다룰 수 있는 사람이 등록자뿐이라
 * 남겨 두면 아무도 답하지 못하는 신청을 받는다. `group_admins` 삭제 트리거가 한다(0056).
 */
export async function leaveGroup(
  userId: string,
  groupId: string,
): Promise<{ deletedGroup: boolean; activeGroupId: string | null }> {
  return withOwnerTx(async (sql) => {
    const mine = await sql.query<{ is_owner: boolean; was_active: boolean }>(
      `SELECT ga.is_owner, (u.active_group_id = ga.group_id) AS was_active
         FROM group_admins ga JOIN users u ON u.id = ga.user_id
        WHERE ga.user_id = $1 AND ga.group_id = $2`,
      [userId, groupId],
    );
    const row = mine.rows[0];
    if (!row) throw new DomainError("NOT_FOUND", "속하지 않은 모임입니다.");

    const others = await sql.query<{ user_id: string }>(
      `SELECT user_id FROM group_admins
        WHERE group_id = $1 AND user_id <> $2 ORDER BY added_at`,
      [groupId, userId],
    );

    let deletedGroup = false;
    if (others.rowCount === 0) {
      const left = await sql.query<{ count: number }>(
        `SELECT (
           (SELECT count(*) FROM profiles WHERE group_id = $1)
           + (SELECT count(*) FROM import_sessions WHERE group_id = $1)
         )::int AS count`,
        [groupId],
      );
      if ((left.rows[0]?.count ?? 0) > 0) {
        throw new DomainError(
          "CONFLICT",
          "모임에 멤버나 가져온 프로필이 남아 있어 나갈 수 없습니다." +
            " 동료 주선자를 먼저 초대하거나, 남은 프로필과 가져오기를 정리한 뒤 나가 주세요.",
        );
      }
      // 빈 모임이다. group_admins·초대 코드는 CASCADE 로 함께 사라진다.
      await sql.query(`DELETE FROM groups WHERE id = $1`, [groupId]);
      deletedGroup = true;
    } else {
      if (row.is_owner) {
        await sql.query(
          `UPDATE group_admins SET is_owner = false WHERE group_id = $1 AND user_id = $2`,
          [groupId, userId],
        );
        await sql.query(
          `UPDATE group_admins SET is_owner = true WHERE group_id = $1 AND user_id = $2`,
          [groupId, others.rows[0]!.user_id],
        );
      }
      await sql.query(`DELETE FROM group_admins WHERE group_id = $1 AND user_id = $2`, [
        groupId,
        userId,
      ]);
    }

    // 나간 모임을 보고 있었다면 트리거가 활성 채널을 비웠다(0036). 그 경우에만 남은
    // 모임 중 하나로 옮겨 준다 — 전체공개를 보고 있었다면 그대로 둔다.
    if (row.was_active) {
      const next = await sql.query<{ active_group_id: string | null }>(
        `UPDATE users u
            SET active_group_id = (
                  SELECT ga.group_id FROM group_admins ga
                   WHERE ga.user_id = u.id ORDER BY ga.added_at LIMIT 1
                )
          WHERE u.id = $1
          RETURNING u.active_group_id`,
        [userId],
      );
      return { deletedGroup, activeGroupId: next.rows[0]?.active_group_id ?? null };
    }

    const current = await sql.query<{ active_group_id: string | null }>(
      `SELECT active_group_id FROM users WHERE id = $1`,
      [userId],
    );
    return { deletedGroup, activeGroupId: current.rows[0]?.active_group_id ?? null };
  });
}

/**
 * 모임을 폐쇄한다. 모임장만 할 수 있다.
 *
 * **비어 있을 때만 지운다** — 멤버나 가져온 프로필이 하나라도 남아 있으면 막는다.
 * 나가기(`leaveGroup`)가 마지막 주선자를 막는 것과 같은 기준이다. 모임이 사라지면
 * 그 데이터는 RLS 가 전부 가려 아무도 되살릴 수 없기 때문에, 폐쇄는 「정리가 끝난
 * 방을 치우는 일」로만 둔다.
 *
 * 다른 주선자가 남아 있어도 지운다. 잃을 멤버가 없는 빈 방이고, 남은 사람들의 소속과
 * 활성 채널은 CASCADE 와 `ON DELETE SET NULL` 이 함께 정리한다(0036).
 */
export async function closeGroup(input: {
  actorId: string;
  groupId: string;
}): Promise<{ activeGroupId: string | null }> {
  await assertGroupOwner(input.actorId, input.groupId);

  return withOwnerTx(async (sql) => {
    const left = await sql.query<{ count: number }>(
      `SELECT (
         (SELECT count(*) FROM profiles WHERE group_id = $1)
         + (SELECT count(*) FROM import_sessions WHERE group_id = $1)
       )::int AS count`,
      [input.groupId],
    );
    if ((left.rows[0]?.count ?? 0) > 0) {
      throw new DomainError(
        "CONFLICT",
        "모임에 멤버나 가져온 프로필이 남아 있어 폐쇄할 수 없습니다." +
          " 남은 프로필과 가져오기를 정리한 뒤 다시 시도해 주세요.",
      );
    }

    const mine = await sql.query<{ was_active: boolean }>(
      `SELECT (active_group_id = $2) AS was_active FROM users WHERE id = $1`,
      [input.actorId, input.groupId],
    );

    // group_admins·초대 코드·채팅은 CASCADE 로, 남은 사람들의 활성 채널은
    // `users.active_group_id` 의 ON DELETE SET NULL 로 함께 정리된다.
    await sql.query(`DELETE FROM groups WHERE id = $1`, [input.groupId]);

    if (!mine.rows[0]?.was_active) {
      const current = await sql.query<{ active_group_id: string | null }>(
        `SELECT active_group_id FROM users WHERE id = $1`,
        [input.actorId],
      );
      return { activeGroupId: current.rows[0]?.active_group_id ?? null };
    }

    // 보고 있던 방을 치웠다. 남은 모임 중 가장 먼저 들어온 곳으로 옮긴다.
    const next = await sql.query<{ active_group_id: string | null }>(
      `UPDATE users u
          SET active_group_id = (
                SELECT ga.group_id FROM group_admins ga
                 WHERE ga.user_id = u.id ORDER BY ga.added_at LIMIT 1
              )
        WHERE u.id = $1
        RETURNING u.active_group_id`,
      [input.actorId],
    );
    return { activeGroupId: next.rows[0]?.active_group_id ?? null };
  });
}
