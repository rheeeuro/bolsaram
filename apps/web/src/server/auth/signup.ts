/**
 * 주선자 가입.
 *
 * 계정과 모임을 **한 트랜잭션으로** 만든다. 계정만 생기고 모임이 없으면 로그인은
 * 되는데 아무것도 못 하는 상태가 남는다.
 *
 * owner 커넥션을 쓰는 이유: 가입은 인증 이전이라 RLS 컨텍스트가 없다. 세션·OTP·
 * 초대 검증과 같은 경로다. 만들어진 계정이 무엇을 볼 수 있는지는 전부 RLS 가 정한다 —
 * **가입 자체는 아무 데이터에도 접근 권한을 주지 않는다.** 자기 모임이 비어 있기 때문이다.
 */
import "server-only";
import { withOwnerTx } from "@bolsaram/db";
import { DomainError } from "@bolsaram/domain";
import { hashPassword } from "../crypto";

export type SignupResult = {
  userId: string;
  groupId: string;
};

export async function signupAdmin(input: {
  email: string;
  password: string;
  displayName: string;
  groupName: string;
}): Promise<SignupResult> {
  return withOwnerTx(async (sql) => {
    let userId: string;
    try {
      const user = await sql.query<{ id: string }>(
        `INSERT INTO users (role, email, password_hash, display_name)
         VALUES ('ADMIN', $1, $2, $3) RETURNING id`,
        [input.email, hashPassword(input.password), input.displayName],
      );
      userId = user.rows[0]!.id;
    } catch (error) {
      // 23505 = unique_violation. users.email 이 UNIQUE 다.
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "23505"
      ) {
        throw new DomainError("CONFLICT", "이미 등록된 이메일입니다.");
      }
      throw error;
    }

    const group = await sql.query<{ id: string }>(
      `INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING id`,
      [input.groupName, userId],
    );
    const groupId = group.rows[0]!.id;

    // 만든 사람이 OWNER 다. 동료 주선자 초대 권한 판정에 쓴다.
    await sql.query(
      `INSERT INTO group_admins (group_id, user_id, is_owner, added_by)
       VALUES ($1, $2, true, $2)`,
      [groupId, userId],
    );

    return { userId, groupId };
  });
}

/**
 * 이미 있는 주선자 계정에 모임을 만들어 준다.
 *
 * 모임에서 제거되면 계정은 남고 모임만 없는 상태가 된다. 그 계정이 다시 시작할 수
 * 있어야 하므로 이 경로를 둔다. **이미 모임이 있으면 만들지 않는다** — 실수로
 * 모임이 늘어나면 어느 모임에서 일하는지 헷갈린다(모임 전환 UI 는 아직 없다).
 *
 * `groups` INSERT 정책을 앱 롤에 주지 않았으므로 owner 커넥션으로만 가능하다 —
 * 모임 소속은 데이터가 아니라 신원에 가깝다는 판단이다.
 */
export async function createGroupForAdmin(input: {
  userId: string;
  name: string;
}): Promise<{ groupId: string }> {
  return withOwnerTx(async (sql) => {
    const existing = await sql.query(`SELECT 1 FROM group_admins WHERE user_id = $1`, [
      input.userId,
    ]);
    if ((existing.rowCount ?? 0) > 0) {
      throw new DomainError("CONFLICT", "이미 모임에 속해 있습니다.");
    }
    const group = await sql.query<{ id: string }>(
      `INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING id`,
      [input.name, input.userId],
    );
    const groupId = group.rows[0]!.id;
    await sql.query(
      `INSERT INTO group_admins (group_id, user_id, is_owner, added_by)
       VALUES ($1, $2, true, $2)`,
      [groupId, input.userId],
    );
    return { groupId };
  });
}
