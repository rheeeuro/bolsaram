/**
 * 초대 / Claim (설계문서 §4 가입, §12 보안).
 *
 * 토큰은 평문으로 저장하지 않는다. pepper 를 섞은 HMAC 만 DB 에 남기고
 * 평문은 발급 시 한 번만 반환한다. claim 은 조건부 UPDATE 로 원자적으로 처리해
 * 같은 토큰을 두 번 쓰는 replay 를 막는다.
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
 * 토큰으로 프로필을 사용자에게 연결한다.
 * `claimed_at IS NULL` 조건을 UPDATE 에 넣어 동시 요청 중 하나만 성공하게 한다.
 */
export async function claimInvite(input: {
  token: string;
  userId: string;
}): Promise<{ profileId: string }> {
  return withOwnerTx(async (sql) => {
    const claimed = await sql.query<{ id: string; profile_id: string }>(
      `UPDATE invites
          SET claimed_at = now(), claimed_by = $2
        WHERE token_hash = $1
          AND claimed_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > now()
        RETURNING id, profile_id`,
      [hashToken(input.token), input.userId],
    );
    const invite = claimed.rows[0];
    if (!invite) {
      throw new DomainError("NOT_FOUND", "만료되었거나 이미 사용된 초대 링크입니다.");
    }

    // 한 사용자는 프로필 하나만 가진다. 먼저 확인해 사용자에게 이유를 알려준다
    // (profiles.user_id UNIQUE 가 최종 방어선이며 아래에서 그 위반도 번역한다).
    const mine = await sql.query<{ id: string }>(`SELECT id FROM profiles WHERE user_id = $1`, [
      input.userId,
    ]);
    const already = mine.rows[0];
    if (already) {
      // 같은 프로필을 다시 claim 한 경우는 성공으로 본다(재시도 안전).
      if (already.id === invite.profile_id) return { profileId: already.id };
      throw new DomainError(
        "CONFLICT",
        "이미 연결된 프로필이 있습니다. 다른 프로필을 연결하려면 주선자에게 문의해 주세요.",
      );
    }

    // 이미 주인이 있는 프로필이면 연결하지 않는다. 트랜잭션째로 되돌린다.
    let linked;
    try {
      linked = await sql.query<{ id: string }>(
        `UPDATE profiles SET user_id = $2
          WHERE id = $1 AND user_id IS NULL
          RETURNING id`,
        [invite.profile_id, input.userId],
      );
    } catch (error) {
      // 23505 = unique_violation. 동시 요청 두 개가 위 검사를 함께 통과한 경우다.
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "23505"
      ) {
        throw new DomainError("CONFLICT", "이미 연결된 프로필이 있습니다.");
      }
      throw error;
    }
    if (linked.rowCount === 0) {
      throw new DomainError("CONFLICT", "이미 다른 계정에 연결된 프로필입니다.");
    }

    return { profileId: invite.profile_id };
  });
}

/** 초대 링크 전체 URL. 관리자 화면에서 복사해 카카오톡으로 보낸다. */
export function inviteUrl(token: string): string {
  return `${env().APP_ORIGIN}/claim/${encodeURIComponent(token)}`;
}
