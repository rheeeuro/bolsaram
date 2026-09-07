/**
 * 초대 링크 = **회원의 로그인 수단**.
 *
 * SMS 를 쓰지 않으므로 회원에게 인증번호를 보낼 방법이 없다. 주선자가 이미 카카오톡으로
 * 초대 링크를 보내고 있으니 그 링크가 세션까지 만든다(매직 링크).
 *
 *   프로필에 주인이 없으면 → 회원 계정을 만들고 연결한 뒤 세션
 *   주인이 있으면        → 그 계정으로 세션 (재로그인)
 *
 * 토큰은 평문으로 저장하지 않는다. pepper 를 섞은 HMAC 만 DB 에 남기고 평문은 발급 시
 * 한 번만 반환한다. 소비는 조건부 UPDATE 로 원자적으로 처리해 replay 를 막는다.
 *
 * 링크를 가진 사람이 곧 그 회원이 된다 — 주선자가 본인에게 직접 전달하는 것이 전제다.
 * 그래서 유효기간을 짧게 두고 1회용으로 만든다. 세션이 만료되면 주선자가 재발급한다.
 */
import "server-only";
import { withOwnerTx } from "@bolsaram/db";
import { DomainError } from "@bolsaram/domain";
import { env } from "../env";
import { peppered, randomToken } from "../crypto";

export type IssuedInvite = {
  inviteId: string;
  /** 평문 토큰. 이 순간 이후 다시 조회할 수 없다. 로그에 남기지 않는다. */
  token: string;
  expiresAt: Date;
};

function hashToken(token: string): string {
  return peppered(env().INVITE_TOKEN_PEPPER, token);
}

export async function issueInvite(input: {
  profileId: string;
  expiresInHours: number;
  createdBy: string;
}): Promise<IssuedInvite> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + input.expiresInHours * 3_600_000);

  // owner 커넥션: 초대 발급은 관리자 동작이지만, claim 검증과 같은 경로를 공유한다.
  const inviteId = await withOwnerTx(async (sql) => {
    // 프로필당 살아 있는 초대는 하나. 기존 것은 회수한다.
    await sql.query(
      `UPDATE invites SET revoked_at = now()
        WHERE profile_id = $1 AND claimed_at IS NULL AND revoked_at IS NULL`,
      [input.profileId],
    );
    const result = await sql.query<{ id: string }>(
      `INSERT INTO invites (profile_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.profileId, hashToken(token), expiresAt, input.createdBy],
    );
    return result.rows[0]!.id;
  });

  return { inviteId, token, expiresAt };
}

export type InvitePreview = {
  inviteId: string;
  profileId: string;
  publicCode: number;
  /** 프로필이 이미 다른 사람에게 연결되어 있으면 claim 할 수 없다. */
  alreadyClaimedProfile: boolean;
};

/** 로그인 전 화면에서 "이 프로필이 맞나요?" 를 보여주기 위한 조회. 상태를 바꾸지 않는다. */
export async function previewInvite(token: string): Promise<InvitePreview> {
  return withOwnerTx(async (sql) => {
    const result = await sql.query<{
      id: string;
      profile_id: string;
      public_code: number;
      user_id: string | null;
    }>(
      `SELECT i.id, i.profile_id, p.public_code, p.user_id
         FROM invites i JOIN profiles p ON p.id = i.profile_id
        WHERE i.token_hash = $1
          AND i.claimed_at IS NULL
          AND i.revoked_at IS NULL
          AND i.expires_at > now()`,
      [hashToken(token)],
    );
    const row = result.rows[0];
    if (!row) {
      throw new DomainError("NOT_FOUND", "만료되었거나 이미 사용된 초대 링크입니다.");
    }
    return {
      inviteId: row.id,
      profileId: row.profile_id,
      publicCode: row.public_code,
      alreadyClaimedProfile: row.user_id != null,
    };
  });
}

/**
 * 토큰을 소비해 **세션을 만들 사용자**를 돌려준다.
 *
 * 프로필에 주인이 없으면 회원 계정을 새로 만든다 — 이 경로가 유일한 회원 가입
 * 경로다(볼사람은 비공개 서비스라 자유 가입이 없다). 이미 주인이 있으면 그 계정으로
 * 재로그인한다.
 *
 * `claimed_at IS NULL` 조건을 UPDATE 에 넣어 동시 요청 중 하나만 성공하게 한다.
 */
export async function consumeInvite(input: {
  token: string;
}): Promise<{ userId: string; profileId: string; firstTime: boolean }> {
  return withOwnerTx(async (sql) => {
    // 먼저 행을 잠근다. `claimed_at`·`claimed_by` 는 CHECK(invites_claim_pair)가
    // 함께 채워지길 요구하므로 **누구로 소비할지 정한 뒤에 한 번에** 써야 한다.
    // FOR UPDATE 로 동시 요청을 직렬화하고, 아래 UPDATE 에 조건을 한 번 더 둔다.
    const found = await sql.query<{ id: string; profile_id: string }>(
      `SELECT id, profile_id FROM invites
        WHERE token_hash = $1
          AND claimed_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > now()
        FOR UPDATE`,
      [hashToken(input.token)],
    );
    const invite = found.rows[0];
    if (!invite) {
      throw new DomainError("NOT_FOUND", "만료되었거나 이미 사용된 링크입니다.");
    }

    const profile = await sql.query<{ user_id: string | null; real_name: string | null }>(
      `SELECT user_id, real_name FROM profiles WHERE id = $1`,
      [invite.profile_id],
    );
    const row = profile.rows[0];
    if (!row) throw new DomainError("NOT_FOUND", "대상 프로필을 찾을 수 없습니다.");

    let userId = row.user_id;
    const firstTime = userId == null;

    if (firstTime) {
      // 첫 진입. 회원 계정을 만든다 — 이 경로가 유일한 회원 가입 경로다.
      // 전화번호는 더 이상 신원이 아니므로 넣지 않는다(0015).
      const created = await sql.query<{ id: string }>(
        `INSERT INTO users (role, display_name) VALUES ('MEMBER', $1) RETURNING id`,
        [row.real_name],
      );
      userId = created.rows[0]!.id;

      const linked = await sql.query<{ id: string }>(
        `UPDATE profiles SET user_id = $2 WHERE id = $1 AND user_id IS NULL RETURNING id`,
        [invite.profile_id, userId],
      );
      if (linked.rowCount === 0) {
        // 경쟁에서 졌다. 트랜잭션째로 되돌아가 방금 만든 계정도 사라진다.
        throw new DomainError("CONFLICT", "이미 다른 계정에 연결된 프로필입니다.");
      }
    }

    const claimed = await sql.query(
      `UPDATE invites SET claimed_at = now(), claimed_by = $2
        WHERE id = $1 AND claimed_at IS NULL`,
      [invite.id, userId],
    );
    if (claimed.rowCount === 0) {
      throw new DomainError("NOT_FOUND", "만료되었거나 이미 사용된 링크입니다.");
    }

    return { userId: userId!, profileId: invite.profile_id, firstTime };
  });
}

/** 링크 전체 URL. 관리자 화면에서 복사해 카카오톡으로 보낸다. */
export function inviteUrl(token: string): string {
  return `${env().APP_ORIGIN}/claim/${encodeURIComponent(token)}`;
}
