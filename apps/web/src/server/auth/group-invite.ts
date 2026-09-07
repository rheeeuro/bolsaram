/**
 * 모임 초대 코드 (동료 주선자 합류).
 *
 * 기존 주선자가 코드를 발급하고, 받은 사람이 그 코드로 자기 계정을 그 모임에 붙인다.
 * `invites`(회원 초대)·`telegram_link_codes` 와 같은 방식이다 — 평문을 저장하지 않고
 * pepper 를 섞은 해시만 남기며, 소비는 조건부 UPDATE 로 한 번만 성공한다(replay 차단).
 *
 * owner 커넥션을 쓰는 이유: 모임 소속은 데이터가 아니라 **신원**에 가깝다.
 * `group_admins` 에 INSERT 정책을 주지 않았으므로 이 경로만이 소속을 바꿀 수 있다.
 */
import "server-only";
import { withOwner, withOwnerTx } from "@bolsaram/db";
import { DomainError } from "@bolsaram/domain";
import { env } from "../env";
import { peppered, randomToken } from "../crypto";

/** 초대 코드 유효시간. 회원 초대(72시간)보다 짧게 둔다 — 주선자 권한이 더 세다. */
export const GROUP_INVITE_TTL_HOURS = 24;

function hashCode(code: string): string {
  return peppered(env().INVITE_TOKEN_PEPPER, `group-invite:${code}`);
}

export type IssuedGroupInvite = {
  /** 평문 코드. 이 순간 이후 다시 조회할 수 없다. 로그에 남기지 않는다. */
  code: string;
  expiresAt: Date;
};

/** 모임에 속한 주선자만 발급할 수 있다(호출부가 requireAdminGroup 으로 확인한다). */
export async function issueGroupInvite(input: {
  groupId: string;
  createdBy: string;
}): Promise<IssuedGroupInvite> {
  const code = randomToken(16);
  const expiresAt = new Date(Date.now() + GROUP_INVITE_TTL_HOURS * 3_600_000);

  await withOwnerTx(async (sql) => {
    // 아직 쓰지 않은 코드는 지운다. 살아 있는 코드가 여러 개면 회수가 어렵다.
    await sql.query(
      `DELETE FROM group_invite_codes
        WHERE group_id = $1 AND created_by = $2 AND consumed_at IS NULL`,
      [input.groupId, input.createdBy],
    );
    await sql.query(
      `INSERT INTO group_invite_codes (code_hash, group_id, created_by, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [hashCode(code), input.groupId, input.createdBy, expiresAt],
    );
  });

  return { code, expiresAt };
}

/**
 * 코드를 소비하고 그 모임에 합류한다.
 *
 * 이미 다른 모임에 속해 있으면 거절한다 — 어느 모임에서 일하는지 헷갈리게 만들지
 * 않는다(모임 전환 UI 가 없다). 먼저 나가고 다시 들어와야 한다.
 */
export async function consumeGroupInvite(input: {
  code: string;
  userId: string;
}): Promise<{ groupId: string }> {
  return withOwnerTx(async (sql) => {
    const already = await sql.query(`SELECT 1 FROM group_admins WHERE user_id = $1`, [
      input.userId,
    ]);
    if ((already.rowCount ?? 0) > 0) {
      throw new DomainError("CONFLICT", "이미 모임에 속해 있습니다.");
    }

    const claimed = await sql.query<{ group_id: string }>(
      `UPDATE group_invite_codes
          SET consumed_at = now(), consumed_by = $2
        WHERE code_hash = $1
          AND consumed_at IS NULL
          AND expires_at > now()
        RETURNING group_id`,
      [hashCode(input.code), input.userId],
    );
    const row = claimed.rows[0];
    if (!row) {
      throw new DomainError("NOT_FOUND", "만료되었거나 이미 사용된 초대 코드입니다.");
    }

    // 합류하는 사람은 OWNER 가 아니다.
    await sql.query(
      `INSERT INTO group_admins (group_id, user_id, is_owner, added_by)
       VALUES ($1, $2, false, (SELECT created_by FROM group_invite_codes WHERE code_hash = $3))`,
      [row.group_id, input.userId, hashCode(input.code)],
    );
    return { groupId: row.group_id };
  });
}

export type GroupSummary = {
  groupId: string;
  name: string;
  /** 주선자들끼리 보는 메모. 회원에게는 노출하지 않는다. */
  description: string | null;
  isOwner: boolean;
  admins: { userId: string; displayName: string | null; isOwner: boolean }[];
};

/** 관리자 화면이 보여줄 내 모임 정보. */
export async function readMyGroup(userId: string): Promise<GroupSummary | null> {
  return withOwner(async (sql) => {
    const g = await sql.query<{
      group_id: string;
      name: string;
      description: string | null;
      is_owner: boolean;
    }>(
      `SELECT g.id AS group_id, g.name, g.description, ga.is_owner
         FROM group_admins ga JOIN groups g ON g.id = ga.group_id
        WHERE ga.user_id = $1 ORDER BY ga.added_at LIMIT 1`,
      [userId],
    );
    const group = g.rows[0];
    if (!group) return null;

    const admins = await sql.query<{
      user_id: string;
      display_name: string | null;
      is_owner: boolean;
    }>(
      `SELECT ga.user_id, u.display_name, ga.is_owner
         FROM group_admins ga JOIN users u ON u.id = ga.user_id
        WHERE ga.group_id = $1 ORDER BY ga.added_at`,
      [group.group_id],
    );
    return {
      groupId: group.group_id,
      name: group.name,
      description: group.description,
      isOwner: group.is_owner,
      admins: admins.rows.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        isOwner: r.is_owner,
      })),
    };
  });
}

/**
 * 모임 이름·설명을 고친다. 보낸 필드만 바꾼다.
 *
 * 같은 모임의 주선자면 누구나 고칠 수 있다 — 한 팀으로 일하는 사이라 개설자만으로
 * 좁히면 개설자가 없을 때 아무도 못 고친다. RLS(`groups_owner_update`)도 같은 판정이다.
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
