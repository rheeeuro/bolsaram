/**
 * 관리자 권한 통합 테스트 (0065).
 *
 * 관리자는 어느 모임에도 속하지 않으면서 모든 모임·모든 프로필을 모임장·등록한
 * 주선자처럼 다룬다. 지켜야 하는 성질은 두 방향이다.
 *
 *   - 관리자에게는 열린다: 남의 모임 프로필 읽기·수정·삭제·메모, 「대신 둘러보기」(대행),
 *     남의 가져오기, 모든 방의 채팅(합류 전 글 포함), 모임장 일.
 *   - **관리자가 아닌 주선자에게는 그대로 닫혀 있다** — 관리자 분기가 정책을 넓히지 않는다.
 *
 * 관리자 지정은 전역 한 줄이라 다른 파일에도 걸린다. 시작할 때 값을 기억했다가
 * 끝날 때 되돌린다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withOwner, withRls, type RlsContext } from "@bolsaram/db";
import {
  assertGroupOwner,
  consumeGroupInvite,
  createGroupForAdmin,
  issueGroupInvite,
  readMyGroups,
  transferGroupOwnership,
} from "../apps/web/src/server/auth/group-invite";
import { syncOperatorAccount } from "../apps/web/src/server/auth/operator";
import { loginWithOAuth } from "../apps/web/src/server/auth/oauth";
import { createMessage, listMessages, unreadByGroup } from "../apps/web/src/server/repo/group-chat";
import { runTag } from "./tags";

const TAG = runTag("opa");

let seq = 0;
function nextEmail(): string {
  seq += 1;
  return `${TAG}-${seq}@test.local`;
}
async function newAdmin(label: string, email = nextEmail()): Promise<string> {
  seq += 1;
  return loginWithOAuth({
    provider: "GOOGLE",
    subject: `${TAG}-sub-${seq}`,
    email,
    displayName: `${TAG}-${label}`,
  });
}
const asAdmin = (userId: string, actingProfileId?: string): RlsContext => ({
  userId,
  role: "ADMIN",
  ...(actingProfileId ? { actingProfileId } : {}),
});

async function setOperator(userId: string | null): Promise<void> {
  await withOwner((sql) =>
    sql.query(`UPDATE operator_settings SET operator_user_id = $1`, [userId]),
  );
}

async function seedProfile(input: {
  groupId: string | null;
  createdBy: string;
  name: string;
  gender?: "FEMALE" | "MALE";
}): Promise<string> {
  return withOwner(async (sql) => {
    const r = await sql.query<{ id: string }>(
      `INSERT INTO profiles (group_id, gender, birth_year, residence_region,
                             status, real_name, created_by)
       VALUES ($1, $2, 1993, 'SEOUL', 'ACTIVE', $3, $4) RETURNING id`,
      [input.groupId, input.gender ?? "FEMALE", `${TAG}-${input.name}`, input.createdBy],
    );
    return r.rows[0]!.id;
  });
}

let initialOperator: string | null = null;
let operatorEmail = "";
let operatorId = "";
let hostA = ""; // 모임 G 의 모임장, 프로필 등록자
let hostB = ""; // 아무 모임에도 없는 주선자 (막혀야 하는 쪽)
let groupId = "";
let groupProfile = "";
let publicProfile = "";
let importId = "";

beforeAll(async () => {
  initialOperator = await withOwner(async (sql) => {
    const r = await sql.query<{ operator_user_id: string | null }>(
      `SELECT operator_user_id FROM operator_settings`,
    );
    return r.rows[0]?.operator_user_id ?? null;
  });

  operatorEmail = nextEmail();
  operatorId = await newAdmin("관리자", operatorEmail);
  hostA = await newAdmin("A");
  hostB = await newAdmin("B");
  groupId = (await createGroupForAdmin({ userId: hostA, name: `${TAG}-G` })).groupId;
  groupProfile = await seedProfile({ groupId, createdBy: hostA, name: "모임" });
  publicProfile = await seedProfile({ groupId: null, createdBy: hostA, name: "공개" });
  importId = await withOwner(async (sql) => {
    const r = await sql.query<{ id: string }>(
      `INSERT INTO import_sessions (group_id, created_by, source, raw_text)
       VALUES ($1, $2, 'TEXT', $3) RETURNING id`,
      [groupId, hostA, `${TAG} 원문`],
    );
    return r.rows[0]!.id;
  });
  // 관리자가 되기 전에 쓰인 글 — 관리자는 합류한 적이 없어도 처음부터 본다.
  await withRls(asAdmin(hostA), (sql) => createMessage(sql, groupId, hostA, `${TAG} 먼저 쓴 글`));

  await setOperator(operatorId);
});

afterAll(async () => {
  await setOperator(initialOperator);
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM import_sessions WHERE raw_text LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM profiles WHERE real_name LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM users WHERE display_name LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM groups WHERE name LIKE $1`, [`${TAG}%`]);
  });
  await closePools();
});

describe("관리자는 모든 프로필을 다룬다", () => {
  it("남의 모임 프로필을 읽고, 고칠 수 있다고 판정된다", async () => {
    const r = await withRls(asAdmin(operatorId), (sql) =>
      sql.query<{ id: string; editable: boolean }>(
        `SELECT id, app_can_edit_profile(id) AS editable FROM profiles WHERE id = ANY($1)`,
        [[groupProfile, publicProfile]],
      ),
    );
    expect(r.rows.map((row) => row.editable)).toEqual([true, true]);
  });

  it("내용을 고쳐도 등록자는 그대로다", async () => {
    await withRls(asAdmin(operatorId), (sql) =>
      sql.query(`UPDATE profiles SET real_name = $2 WHERE id = $1`, [
        groupProfile,
        `${TAG}-모임-고침`,
      ]),
    );
    const r = await withOwner((sql) =>
      sql.query<{ real_name: string; created_by: string }>(
        `SELECT real_name, created_by FROM profiles WHERE id = $1`,
        [groupProfile],
      ),
    );
    expect(r.rows[0]).toEqual({ real_name: `${TAG}-모임-고침`, created_by: hostA });
  });

  it("메모를 쓰고 상태를 바꾸고 지울 수 있다", async () => {
    const victim = await seedProfile({ groupId, createdBy: hostA, name: "지울" });
    await withRls(asAdmin(operatorId), async (sql) => {
      await sql.query(`INSERT INTO profile_memos (profile_id, body) VALUES ($1, '관리자 메모')`, [
        victim,
      ]);
      await sql.query(`UPDATE profiles SET status = 'INACTIVE' WHERE id = $1`, [victim]);
      const deleted = await sql.query(`DELETE FROM profiles WHERE id = $1`, [victim]);
      expect(deleted.rowCount).toBe(1);
    });
  });

  it("「대신 둘러보기」로 어느 프로필이든 대행한다", async () => {
    const current = await withRls(asAdmin(operatorId, groupProfile), (sql) =>
      sql.query<{ id: string | null }>(`SELECT app_current_profile_id() AS id`),
    );
    expect(current.rows[0]?.id).toBe(groupProfile);
  });

  it("남이 가져온 원본을 읽고 고친다", async () => {
    const r = await withRls(asAdmin(operatorId), (sql) =>
      sql.query(`UPDATE import_sessions SET raw_text = $2 WHERE id = $1`, [
        importId,
        `${TAG} 원문 고침`,
      ]),
    );
    expect(r.rowCount).toBe(1);
  });
});

describe("관리자가 아닌 주선자에게는 그대로 닫혀 있다", () => {
  it("남의 모임 프로필은 보이지 않고, 전체공개 프로필도 고치지 못한다", async () => {
    await withRls(asAdmin(hostB), async (sql) => {
      const seen = await sql.query(`SELECT 1 FROM profiles WHERE id = $1`, [groupProfile]);
      expect(seen.rowCount).toBe(0);
      const updated = await sql.query(`UPDATE profiles SET real_name = 'x' WHERE id = $1`, [
        publicProfile,
      ]);
      expect(updated.rowCount).toBe(0);
      const current = await sql.query<{ id: string | null }>(
        `SELECT app_current_profile_id() AS id`,
      );
      expect(current.rows[0]?.id).toBeNull();
    });
  });

  it("남의 가져오기와 그 모임 채팅을 읽지 못한다", async () => {
    await withRls(asAdmin(hostB), async (sql) => {
      expect((await sql.query(`SELECT 1 FROM import_sessions WHERE id = $1`, [importId])).rowCount).toBe(0);
      expect((await sql.query(`SELECT 1 FROM group_messages WHERE group_id = $1`, [groupId])).rowCount).toBe(0);
    });
    await expect(assertGroupOwner(hostB, groupId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("관리자 칸을 직접 읽거나 바꾸지 못한다", async () => {
    await expect(
      withRls(asAdmin(hostB), (sql) =>
        sql.query(`UPDATE operator_settings SET operator_user_id = $1`, [hostB]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("관리자는 모든 모임을 다룬다", () => {
  it("합류한 적 없는 방의 처음 글부터 읽고 쓴다", async () => {
    const messages = await withRls(asAdmin(operatorId), async (sql) => {
      await createMessage(sql, groupId, operatorId, `${TAG} 관리자 글`);
      return listMessages(sql, groupId, { limit: 50 });
    });
    const bodies = messages.map((m) => m.body);
    expect(bodies).toContain(`${TAG} 먼저 쓴 글`);
    expect(bodies).toContain(`${TAG} 관리자 글`);
    const unread = await withRls(asAdmin(operatorId), (sql) => unreadByGroup(sql, operatorId));
    expect(unread.map((u) => u.groupId)).toContain(groupId);
  });

  it("모든 모임이 목록에 관리자로 나오고, 모임장 일을 한다", async () => {
    const groups = await readMyGroups(operatorId);
    const mine = groups.find((g) => g.groupId === groupId);
    expect(mine).toMatchObject({ asOperator: true, isOwner: false });
    await assertGroupOwner(operatorId, groupId);

    const colleague = await newAdmin("동료");
    const issued = await issueGroupInvite({ groupId, createdBy: hostA });
    await consumeGroupInvite({ code: issued.code, userId: colleague });
    await transferGroupOwnership({ actorId: operatorId, groupId, targetUserId: colleague });
    const after = (await readMyGroups(hostA)).find((g) => g.groupId === groupId);
    expect(after?.admins.filter((a) => a.isOwner).map((a) => a.userId)).toEqual([colleague]);
  });

  it("모임에 속할 수 없다 — 초대 코드를 써도 코드가 남는다", async () => {
    const issued = await issueGroupInvite({ groupId, createdBy: hostA });
    await expect(
      consumeGroupInvite({ code: issued.code, userId: operatorId }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      withOwner((sql) =>
        sql.query(
          `INSERT INTO group_admins (group_id, user_id, is_owner, added_by) VALUES ($1, $2, false, $2)`,
          [groupId, operatorId],
        ),
      ),
    ).rejects.toThrow(/관리자는 모임에 속하지 않습니다/);
    // 관리자가 막힌 뒤에도 동료는 같은 코드로 들어온다.
    const late = await newAdmin("늦게");
    await consumeGroupInvite({ code: issued.code, userId: late });
  });

  it("관리자가 만든 모임에는 주선자가 없다", async () => {
    const { groupId: made } = await createGroupForAdmin({ userId: operatorId, name: `${TAG}-관` });
    const admins = await withOwner((sql) =>
      sql.query(`SELECT 1 FROM group_admins WHERE group_id = $1`, [made]),
    );
    expect(admins.rowCount).toBe(0);
  });
});

describe("관리자 지정 동기화", () => {
  it("기존 소속을 걷어내고 모임장은 넘기되, 등록한 프로필과 방은 건드리지 않는다", async () => {
    const email = nextEmail();
    const future = await newAdmin("새관리자", email);
    const { groupId: owned } = await createGroupForAdmin({ userId: future, name: `${TAG}-S` });
    const other = await newAdmin("남는사람");
    const issued = await issueGroupInvite({ groupId: owned, createdBy: future });
    await consumeGroupInvite({ code: issued.code, userId: other });
    const kept = await seedProfile({ groupId: owned, createdBy: future, name: "유지" });

    try {
      expect(await syncOperatorAccount(email)).toBe(future);

      const state = await withOwner(async (sql) => {
        const admins = await sql.query<{ user_id: string; is_owner: boolean }>(
          `SELECT user_id, is_owner FROM group_admins WHERE group_id = $1`,
          [owned],
        );
        const profile = await sql.query<{ status: string }>(
          `SELECT status FROM profiles WHERE id = $1`,
          [kept],
        );
        const left = await sql.query(
          `SELECT 1 FROM group_messages WHERE group_id = $1 AND system_kind = 'ADMIN_LEFT'`,
          [owned],
        );
        return { admins: admins.rows, status: profile.rows[0]?.status, left: left.rowCount };
      });
      expect(state.admins).toEqual([{ user_id: other, is_owner: true }]);
      expect(state.status).toBe("ACTIVE");
      expect(state.left).toBe(0);

      // 맞는 계정이 없으면 관리자를 비운다.
      expect(await syncOperatorAccount(`${TAG}-없음@test.local`)).toBeNull();
    } finally {
      await setOperator(operatorId);
    }
  });
});
