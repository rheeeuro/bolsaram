/**
 * 주선자 가입.
 *
 * **모임은 만들지 않는다.** 주선자와 모임은 별개다 — 가입하면 소속 없이 시작해서
 * 전체공개 프로필(`group_id IS NULL`)을 둘러보고, 필요하면 모임을 만들거나
 * 초대 코드로 참여한다.
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
};

export async function signupAdmin(input: {
  email: string;
  password: string;
  displayName: string;
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

    return { userId };
  });
}

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
