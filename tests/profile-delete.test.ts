/**
 * 프로필 삭제 통합 테스트.
 *
 * 처리방침의 약속은 「내리고 싶다고 하면 프로필·사진·계정을 지운다」다. 지키는 성질:
 * - **등록한 주선자만** 지운다. 같은 모임 동료도 못 지운다.
 * - 멤버 계정 정책(0061)은 **내가 고칠 수 있는 프로필에 연결된 멤버**만 연다.
 *   주선자 계정이나 남의 멤버는 지울 수 없다.
 * - 지우면 가져오기 원문·에셋·연결된 계정·신청까지 함께 사라지고, 지울 파일 키를 돌려준다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withOwner, withRls, type RlsContext } from "@bolsaram/db";
import { deleteProfile } from "../apps/web/src/server/repo/profiles";
import { runTag } from "./tags";

const TAG = runTag("del");
let owner: RlsContext;
let peer: RlsContext;
let groupId: string;
let target: { profileId: string; memberId: string; sessionId: string };
let otherProfileId: string;

beforeAll(async () => {
  const fixture = await withOwner(async (sql) => {
    const g = await sql.query<{ id: string }>(
      `INSERT INTO groups (name) VALUES ($1) RETURNING id`,
      [TAG],
    );
    const group = g.rows[0]!.id;
    const admin = async (n: string, isOwner: boolean) => {
      const u = await sql.query<{ id: string }>(
        `INSERT INTO users (role, email, display_name) VALUES ('ADMIN', $1, $2) RETURNING id`,
        [`${TAG}-${n}@test.local`, `${TAG}${n}`],
      );
      await sql.query(
        `INSERT INTO group_admins (group_id, user_id, is_owner) VALUES ($1, $2, $3)`,
        [group, u.rows[0]!.id, isOwner],
      );
      return u.rows[0]!.id;
    };
    const ownerId = await admin("a", true);
    const peerId = await admin("b", false);

    const m = await sql.query<{ id: string }>(
      `INSERT INTO users (role, display_name) VALUES ('MEMBER', $1) RETURNING id`,
      [`${TAG}m`],
    );
    const memberId = m.rows[0]!.id;

    const profile = async (gender: string, userId: string | null) => {
      const p = await sql.query<{ id: string }>(
        `INSERT INTO profiles (group_id, gender, birth_year, residence_region, created_by, user_id)
         VALUES ($1, $2, 1993, 'SEOUL', $3, $4) RETURNING id`,
        [group, gender, ownerId, userId],
      );
      return p.rows[0]!.id;
    };
    const profileId = await profile("FEMALE", memberId);
    const other = await profile("MALE", null);

    // 프로필 사진과 가져오기 에셋이 같은 키를 가리키는 운영 모양 그대로.
    await sql.query(
      `INSERT INTO profile_images (profile_id, storage_key, mime_type, byte_size, sort_order, is_primary)
       VALUES ($1, $2, 'image/jpeg', 100, 0, true)`,
      [profileId, `${TAG}/shared.jpg`],
    );
    const s = await sql.query<{ id: string }>(
      `INSERT INTO import_sessions (created_by, group_id, status, raw_text, committed_profile_id, committed_at)
       VALUES ($1, $2, 'IMPORTED', '합성 원문', $3, now()) RETURNING id`,
      [ownerId, group, profileId],
    );
    const sessionId = s.rows[0]!.id;
    await sql.query(
      `INSERT INTO import_assets (import_session_id, storage_key, mime_type, byte_size, sort_order, uploaded_at)
       VALUES ($1, $2, 'image/jpeg', 100, 0, now()), ($1, $3, 'image/jpeg', 100, 1, now())`,
      [sessionId, `${TAG}/shared.jpg`, `${TAG}/extra.jpg`],
    );
    await sql.query(
      `INSERT INTO match_requests (requester_profile_id, target_profile_id) VALUES ($1, $2)`,
      [other, profileId],
    );

    return { group, ownerId, peerId, profileId, memberId, sessionId, other };
  });

  groupId = fixture.group;
  owner = { userId: fixture.ownerId, role: "ADMIN" };
  peer = { userId: fixture.peerId, role: "ADMIN" };
  target = {
    profileId: fixture.profileId,
    memberId: fixture.memberId,
    sessionId: fixture.sessionId,
  };
  otherProfileId = fixture.other;
});

afterAll(async () => {
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM import_sessions WHERE committed_profile_id = $1`, [
      target.profileId,
    ]);
    await sql.query(`DELETE FROM profiles WHERE id = ANY($1)`, [
      [target.profileId, otherProfileId],
    ]);
    await sql.query(`DELETE FROM users WHERE display_name LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM groups WHERE id = $1`, [groupId]);
  });
  await closePools();
});

async function exists(table: string, id: string): Promise<boolean> {
  return withOwner(async (sql) => {
    const r = await sql.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
    return (r.rowCount ?? 0) > 0;
  });
}

describe("프로필 삭제 — 막히는 것", () => {
  it("같은 모임 동료는 지우지 못하고, 아무것도 지워지지 않는다", async () => {
    await expect(withRls(peer, (sql) => deleteProfile(sql, target.profileId))).rejects.toThrow();
    expect(await exists("profiles", target.profileId)).toBe(true);
    expect(await exists("users", target.memberId)).toBe(true);
    expect(await exists("import_sessions", target.sessionId)).toBe(true);
  });

  it("동료는 그 멤버 계정을 직접 지우지 못한다", async () => {
    const r = await withRls(peer, (sql) =>
      sql.query(`DELETE FROM users WHERE id = $1`, [target.memberId]),
    );
    expect(r.rowCount).toBe(0);
  });

  it("등록한 주선자도 다른 주선자 계정은 지우지 못한다", async () => {
    const r = await withRls(owner, (sql) =>
      sql.query(`DELETE FROM users WHERE id = $1`, [peer.userId]),
    );
    expect(r.rowCount).toBe(0);
    expect(await exists("users", peer.userId)).toBe(true);
  });
});

describe("프로필 삭제 — 등록한 주선자", () => {
  it("프로필·원본·멤버 계정·신청을 함께 지우고 파일 키를 한 번씩 돌려준다", async () => {
    const result = await withRls(owner, (sql) => deleteProfile(sql, target.profileId));

    expect(result.memberDeleted).toBe(true);
    expect(result.storageKeys.sort()).toEqual([`${TAG}/extra.jpg`, `${TAG}/shared.jpg`]);

    expect(await exists("profiles", target.profileId)).toBe(false);
    expect(await exists("users", target.memberId)).toBe(false);
    expect(await exists("import_sessions", target.sessionId)).toBe(false);

    const left = await withOwner(async (sql) => {
      const r = await sql.query<{ n: number }>(
        `SELECT
           (SELECT count(*) FROM match_requests
             WHERE requester_profile_id = $1 OR target_profile_id = $1)
         + (SELECT count(*) FROM profile_images WHERE profile_id = $1)
         + (SELECT count(*) FROM import_assets WHERE storage_key LIKE $2) AS n`,
        [target.profileId, `${TAG}/%`],
      );
      return Number(r.rows[0]!.n);
    });
    expect(left).toBe(0);
    // 상대 프로필은 남는다.
    expect(await exists("profiles", otherProfileId)).toBe(true);
  });
});
