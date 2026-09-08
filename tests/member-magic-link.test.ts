/**
 * 회원 로그인 = 초대 링크 (매직 링크) 통합 테스트.
 *
 * SMS 를 쓰지 않으므로 회원에게 인증번호를 보낼 방법이 없다. 주선자가 카카오톡으로
 * 보내는 초대 링크가 곧 로그인이며, **이 경로가 유일한 회원 가입 경로**다.
 *
 * 여기서 지키는 성질:
 *   * 링크 하나로 계정이 만들어지고 프로필에 연결된다.
 *   * 같은 링크를 두 번 쓸 수 없다(replay 차단).
 *   * 이미 주인이 있는 프로필은 계정을 새로 만들지 않고 재로그인한다.
 *   * 만료·회수된 링크는 통하지 않는다.
 *   * 링크를 쓴 회원을 나중에 삭제할 수 있다(0016 제약 완화).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withOwner } from "@bolsaram/db";
import { consumeInvite, issueInvite, previewInvite } from "../apps/web/src/server/auth/invite";

const TAG = `magiclink-${Date.now()}`;
let adminId: string;

/** 주인 없는 전체공개 프로필을 만든다. */
async function newProfile(name: string): Promise<string> {
  return withOwner(async (sql) => {
    const r = await sql.query<{ id: string }>(
      `INSERT INTO profiles (group_id, gender, birth_year, residence_region,
                             status, visibility, real_name, created_by)
       VALUES (NULL,'FEMALE',1994,'SEOUL','ACTIVE','LISTED',$1,$2) RETURNING id`,
      [`${TAG}-${name}`, adminId],
    );
    return r.rows[0]!.id;
  });
}

beforeAll(async () => {
  adminId = await withOwner(async (sql) => {
    const r = await sql.query<{ id: string }>(
      `INSERT INTO users (role, email, password_hash, display_name)
       VALUES ('ADMIN', $1, 'x', $2) RETURNING id`,
      [`${TAG}@test.local`, `${TAG}-주선자`],
    );
    return r.rows[0]!.id;
  });
});

afterAll(async () => {
  await withOwner(async (sql) => {
    await sql.query(
      `DELETE FROM users WHERE id IN
         (SELECT user_id FROM profiles WHERE real_name LIKE $1 AND user_id IS NOT NULL)`,
      [`${TAG}%`],
    );
    await sql.query(`DELETE FROM profiles WHERE real_name LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM users WHERE display_name LIKE $1`, [`${TAG}%`]);
  });
  await closePools();
});

async function link(profileId: string, hours = 72): Promise<string> {
  const issued = await issueInvite({ profileId, expiresInHours: hours, createdBy: adminId });
  return issued.token;
}

describe("최초 진입", () => {
  it("링크 하나로 계정이 만들어지고 프로필에 연결된다", async () => {
    const profileId = await newProfile("최초");
    const token = await link(profileId);

    const result = await consumeInvite({ token });
    expect(result.firstTime).toBe(true);
    expect(result.profileId).toBe(profileId);
    expect(result.userId).toMatch(/^[0-9a-f-]{36}$/);

    const linked = await withOwner(async (sql) => {
      const r = await sql.query<{ user_id: string | null; role: string; phone: string | null }>(
        `SELECT p.user_id, u.role, u.phone
           FROM profiles p JOIN users u ON u.id = p.user_id
          WHERE p.id = $1`,
        [profileId],
      );
      return r.rows[0];
    });
    expect(linked?.user_id).toBe(result.userId);
    expect(linked?.role).toBe("MEMBER");
    // 전화번호는 더 이상 신원이 아니다 — 없어도 회원이 된다(0015).
    expect(linked?.phone).toBeNull();
  });

  it("같은 링크를 두 번 쓸 수 없다", async () => {
    const profileId = await newProfile("재사용");
    const token = await link(profileId);
    await consumeInvite({ token });
    await expect(consumeInvite({ token })).rejects.toThrow(/이미 사용된 링크/);
  });

  it("만료된 링크는 통하지 않는다", async () => {
    const profileId = await newProfile("만료");
    const token = await link(profileId);
    await withOwner((sql) =>
      sql.query(
        `UPDATE invites SET expires_at = now() - interval '1 minute' WHERE profile_id = $1`,
        [profileId],
      ),
    );
    await expect(consumeInvite({ token })).rejects.toThrow(/만료/);
  });

  it("회수된 링크는 통하지 않는다", async () => {
    const profileId = await newProfile("회수");
    const token = await link(profileId);
    await withOwner((sql) =>
      sql.query(`UPDATE invites SET revoked_at = now() WHERE profile_id = $1`, [profileId]),
    );
    await expect(consumeInvite({ token })).rejects.toThrow(/만료되었거나 이미 사용된/);
  });

  it("새 링크를 발급하면 이전 링크가 죽는다", async () => {
    const profileId = await newProfile("재발급");
    const first = await link(profileId);
    await link(profileId);
    await expect(consumeInvite({ token: first })).rejects.toThrow(/만료되었거나 이미 사용된/);
  });
});

describe("재로그인", () => {
  it("이미 주인이 있으면 계정을 새로 만들지 않는다", async () => {
    const profileId = await newProfile("재로그인");
    const first = await consumeInvite({ token: await link(profileId) });

    const second = await consumeInvite({ token: await link(profileId) });
    expect(second.firstTime).toBe(false);
    expect(second.userId).toBe(first.userId);

    const members = await withOwner(async (sql) => {
      const r = await sql.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM users
          WHERE role = 'MEMBER' AND display_name = $1`,
        [`${TAG}-재로그인`],
      );
      return r.rows[0]!.count;
    });
    // 링크를 여러 번 써도 계정은 하나다.
    expect(members).toBe(1);
  });
});

describe("링크 미리보기", () => {
  it("소비하지 않고 대상 프로필을 확인한다", async () => {
    const profileId = await newProfile("미리보기");
    const token = await link(profileId);
    const preview = await previewInvite(token);
    expect(preview).toMatchObject({ profileId, alreadyClaimedProfile: false });
    // 미리보기는 상태를 바꾸지 않으므로 그 뒤에도 쓸 수 있다.
    await expect(consumeInvite({ token })).resolves.toMatchObject({ firstTime: true });
  });
});

describe("회원 삭제", () => {
  it("링크를 쓴 회원을 삭제할 수 있다", async () => {
    // 0016 이전에는 invites_claim_pair 때문에 DELETE 가 실패했다 —
    // FK 가 claimed_by 를 NULL 로 바꾸려 하면 제약에 걸렸다. 탈퇴 처리가 막히는 셈이다.
    const profileId = await newProfile("탈퇴");
    const { userId } = await consumeInvite({ token: await link(profileId) });

    await expect(
      withOwner(async (sql) => {
        await sql.query(`UPDATE profiles SET user_id = NULL WHERE id = $1`, [profileId]);
        await sql.query(`DELETE FROM users WHERE id = $1`, [userId]);
      }),
    ).resolves.not.toThrow();

    // 초대 기록은 남고 쓴 사람만 지워진다.
    const invite = await withOwner(async (sql) => {
      const r = await sql.query<{ claimed_at: Date | null; claimed_by: string | null }>(
        `SELECT claimed_at, claimed_by FROM invites WHERE profile_id = $1`,
        [profileId],
      );
      return r.rows[0];
    });
    expect(invite?.claimed_at).not.toBeNull();
    expect(invite?.claimed_by).toBeNull();
  });
});
