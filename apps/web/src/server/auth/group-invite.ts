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
 * 성공한다(replay 차단).
 *
 * owner 커넥션을 쓰는 이유: 모임 소속은 데이터가 아니라 **신원**에 가깝다.
 * `group_admins` 에 INSERT 정책을 주지 않았으므로 이 경로만이 소속을 바꿀 수 있다.
 * 활성 채널(`users.active_group_id`)도 앱 롤의 UPDATE 권한에서 빼 두었다.
 */
import "server-only";
import { withOwner, withOwnerTx } from "@bolsaram/db";
import { DomainError } from "@bolsaram/domain";
import { env } from "../env";
import { peppered, randomToken } from "../crypto";

/**
 * 이미 있는 주선자 계정에 모임을 만들어 준다.
 *
 * 가입은 계정만 만들므로 모임이 필요하면 여기를 지난다. **몇 개든 만들 수 있다** —
 * 한 주선자가 여러 모임에서 일하고 화면에서 채널처럼 오간다(0036). 만든 모임을 바로
 * 활성 채널로 만들어 준다.
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
    const group = await sql.query<{ id: string }>(
      `INSERT INTO groups (name, description, created_by) VALUES ($1, $2, $3) RETURNING id`,
      [input.name, input.description?.trim() || null, input.userId],
    );
    const groupId = group.rows[0]!.id;
    await sql.query(
      `INSERT INTO group_admins (group_id, user_id, is_owner, added_by)
       VALUES ($1, $2, true, $2)`,
      [groupId, input.userId],
    );
    // 방금 만든 모임을 보고 있게 한다 — 만들자마자 그 안에서 일할 것이다.
    await sql.query(`UPDATE users SET active_group_id = $2 WHERE id = $1`, [
      input.userId,
      groupId,
    ]);
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
 * 아니라 **애플리케이션 레이어의 몫 전체**다.
 */
export async function assertGroupAdmin(userId: string, groupId: string): Promise<void> {
  const result = await withOwner((sql) =>
    sql.query(`SELECT 1 FROM group_admins WHERE user_id = $1 AND group_id = $2`, [
      userId,
      groupId,
    ]),
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
};

/** 모임에 속한 주선자만 발급할 수 있다(호출부가 `assertGroupAdmin` 으로 확인한다). */
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
 * 코드를 소비하고 그 모임에 합류한다. 이미 속한 모임이 있어도 상관없다 —
 * 여러 모임에 동시에 속할 수 있다. 합류한 모임을 바로 활성 채널로 만든다.
 */
export async function consumeGroupInvite(input: {
  code: string;
  userId: string;
}): Promise<{ groupId: string }> {
  return withOwnerTx(async (sql) => {
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

    // 이미 그 모임에 있으면 코드만 소비되고 소속은 그대로다. 실수로 두 번 넣어도
    // 오류 대신 그 모임으로 옮겨 주는 편이 낫다.
    const already = await sql.query(
      `SELECT 1 FROM group_admins WHERE group_id = $1 AND user_id = $2`,
      [row.group_id, input.userId],
    );
    if ((already.rowCount ?? 0) === 0) {
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
  /** 이 모임에 등록된 멤버 수. 목록에서 어느 방이 활발한지 가늠하는 데 쓴다. */
  memberCount: number;
  /** 이 모임으로 가져온 Import 건수. 폐쇄를 막는 것이 무엇인지 화면에 적을 때 쓴다. */
  importCount: number;
  admins: { userId: string; displayName: string | null; isOwner: boolean }[];
  /** 이 방의 새 채팅을 텔레그램으로도 받을 것인가(0040). 사람마다 따로 켠다. */
  chatNotify: boolean;
};

/**
 * 내가 속한 모임 전부. 들어간 순서대로 준다.
 *
 * 주선자 화면의 채널 목록이자 모임 설정 화면의 내용이다. 모임이 하나도 없는 것도
 * 정상이다(가입 직후) — 그때는 전체공개 채널만 쓴다.
 */
export async function readMyGroups(userId: string): Promise<GroupSummary[]> {
  return withOwner(async (sql) => {
    const groups = await sql.query<{
      group_id: string;
      name: string;
      description: string | null;
      image_key: string | null;
      is_owner: boolean;
      member_count: number;
      import_count: number;
      chat_notify: boolean;
    }>(
      `SELECT g.id AS group_id, g.name, g.description, g.image_key, ga.is_owner,
              (SELECT count(*)::int FROM profiles p WHERE p.group_id = g.id) AS member_count,
              (SELECT count(*)::int FROM import_sessions i WHERE i.group_id = g.id) AS import_count,
              COALESCE(pref.telegram_notify, false) AS chat_notify
         FROM group_admins ga
         JOIN groups g ON g.id = ga.group_id
         LEFT JOIN group_chat_prefs pref
           ON pref.group_id = g.id AND pref.user_id = ga.user_id
        WHERE ga.user_id = $1 ORDER BY ga.added_at`,
      [userId],
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
      memberCount: group.member_count,
      importCount: group.import_count,
      chatNotify: group.chat_notify,
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
  const result = await withOwner((sql) =>
    sql.query(
      `SELECT 1 FROM group_admins WHERE user_id = $1 AND group_id = $2 AND is_owner`,
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

    await sql.query(
      `UPDATE group_admins SET is_owner = false WHERE group_id = $1 AND user_id = $2`,
      [input.groupId, input.actorId],
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
    const removed = await sql.query(
      `DELETE FROM group_admins WHERE group_id = $1 AND user_id = $2`,
      [input.groupId, input.targetUserId],
    );
    if (removed.rowCount === 0) {
      throw new DomainError("NOT_FOUND", "이 모임의 주선자가 아닙니다.");
    }
  });
}

/**
 * 모임 하나에서 나간다.
 *
 * 막는 경우가 하나 있다 — **마지막 주선자인데 모임에 멤버나 Import 가 남아 있으면**
 * 나갈 수 없다. 나가면 그 데이터를 아무도 볼 수 없게 되고(RLS 가 전부 막는다) 되돌릴
 * 방법도 없다. 먼저 멤버를 전체공개로 옮기거나 동료를 초대하라고 알려준다.
 *
 * 비어 있는 모임이면 나가면서 모임까지 지운다 — 주인 없는 빈 모임을 남기지 않는다.
 * 모임장이 나가고 다른 주선자가 남으면 가장 먼저 들어온 사람에게 모임장을 넘긴다
 * (`group_admins_one_owner` 때문에 모임장 없는 모임을 만들 수 없다).
 *
 * 나간 모임을 보고 있었다면 활성 채널은 남아 있는 다른 모임으로 옮기고, 없으면
 * 전체공개가 된다.
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
            " 전체공개로 옮기거나 동료 주선자를 초대한 뒤 나가 주세요.",
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
          " 전체공개로 옮기거나 정리한 뒤 다시 시도해 주세요.",
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
