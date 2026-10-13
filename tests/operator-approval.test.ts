/**
 * 관리자 설정 · 모임 만들기 승인 통합 테스트.
 *
 * 승인이 켜져 있으면 주선자의 「모임 만들기」는 모임을 만들지 않고 요청만 남긴다.
 * 지켜야 하는 성질은 **승인 없이는 모임도 소속도 생기지 않는다**는 것과, 관리자만
 * 다루는 테이블이 런타임 롤에서 열리지 않는다는 것이다.
 *
 * 초대 코드 여러 번 쓰기는 **켜기는 소급하지 않고 끄기는 바로 걸린다**는 성질을 본다.
 *
 * 설정은 전역 한 줄이라 다른 테스트 파일에도 걸린다. 파일은 순차로 돌고, 이 파일은
 * 끝날 때 처음 값으로 되돌린다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withOwner, withRls } from "@bolsaram/db";
import { MAX_GROUPS_PER_ADMIN } from "@bolsaram/schemas";
import {
  cancelGroupCreationRequest,
  consumeGroupInvite,
  createGroupForAdmin,
  decideGroupCreationRequest,
  issueGroupInvite,
  readMyGroupRequests,
  readMyGroups,
  requestGroupCreation,
} from "../apps/web/src/server/auth/group-invite";
import {
  listGroupCreationRequests,
  readOperatorSettings,
  updateOperatorSettings,
} from "../apps/web/src/server/auth/operator";
import { loginWithOAuth } from "../apps/web/src/server/auth/oauth";
import { runTag } from "./tags";

const TAG = runTag("opr");

let seq = 0;
async function newAdmin(label: string): Promise<string> {
  seq += 1;
  return loginWithOAuth({
    provider: "GOOGLE",
    subject: `${TAG}-sub-${seq}`,
    email: `${TAG}-${seq}@test.local`,
    displayName: `${TAG}-${label}`,
  });
}

async function membershipCount(userId: string): Promise<number> {
  return withOwner(async (sql) => {
    const r = await sql.query(`SELECT 1 FROM group_admins WHERE user_id = $1`, [userId]);
    return r.rowCount ?? 0;
  });
}

let operatorId = "";
let initialApproval = false;
let initialInviteReusable = false;

beforeAll(async () => {
  const initial = await readOperatorSettings();
  initialApproval = initial.groupCreationRequiresApproval;
  initialInviteReusable = initial.groupInviteReusable;
  operatorId = await newAdmin("관리자");
});

afterAll(async () => {
  await updateOperatorSettings({
    operatorId,
    groupCreationRequiresApproval: initialApproval,
    groupInviteReusable: initialInviteReusable,
  });
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM users WHERE display_name LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM groups WHERE name LIKE $1`, [`${TAG}%`]);
  });
  await closePools();
});

describe("승인이 꺼져 있으면", () => {
  it("모임이 바로 만들어진다", async () => {
    await updateOperatorSettings({ operatorId, groupCreationRequiresApproval: false });
    const admin = await newAdmin("바로");
    const result = await requestGroupCreation({
      userId: admin,
      isOperator: false,
      name: `${TAG}-바로`,
    });
    expect(result.status).toBe("CREATED");
    expect(await membershipCount(admin)).toBe(1);
  });
});

describe("승인이 켜져 있으면", () => {
  beforeAll(async () => {
    await updateOperatorSettings({ operatorId, groupCreationRequiresApproval: true });
  });

  it("요청만 남고 모임도 소속도 생기지 않는다", async () => {
    const admin = await newAdmin("요청");
    const result = await requestGroupCreation({
      userId: admin,
      isOperator: false,
      name: `${TAG}-요청`,
      description: "  설명  ",
    });
    expect(result.status).toBe("PENDING");
    expect(await membershipCount(admin)).toBe(0);
    const groups = await withOwner(async (sql) =>
      sql.query(`SELECT 1 FROM groups WHERE name = $1`, [`${TAG}-요청`]),
    );
    expect(groups.rowCount).toBe(0);

    const mine = await readMyGroupRequests(admin);
    expect(mine.map((r) => [r.name, r.status])).toEqual([[`${TAG}-요청`, "PENDING"]]);
    const { pending } = await listGroupCreationRequests();
    const listed = pending.find((r) => r.name === `${TAG}-요청`);
    expect(listed?.description).toBe("설명");
    expect(listed?.requester.userId).toBe(admin);
  });

  it("관리자 본인은 기다리지 않고 바로 만든다", async () => {
    const result = await requestGroupCreation({
      userId: operatorId,
      isOperator: true,
      name: `${TAG}-관리자방`,
    });
    expect(result.status).toBe("CREATED");
  });

  it("승인하면 모임이 생기고 요청한 주선자가 모임장이 된다 — 두 번 승인해도 하나다", async () => {
    const admin = await newAdmin("승인");
    const result = await requestGroupCreation({
      userId: admin,
      isOperator: false,
      name: `${TAG}-승인`,
    });
    if (result.status !== "PENDING") throw new Error("요청이 남지 않았다");

    const decided = await decideGroupCreationRequest({
      requestId: result.requestId,
      operatorId,
      approve: true,
    });
    expect(decided.groupId).not.toBeNull();
    const groups = await readMyGroups(admin);
    expect(groups.map((g) => [g.name, g.isOwner])).toEqual([[`${TAG}-승인`, true]]);
    // 승인된 요청은 대기 목록에서 빠진다 — 모임 목록에 모임으로 보인다.
    expect(await readMyGroupRequests(admin)).toEqual([]);

    await expect(
      decideGroupCreationRequest({ requestId: result.requestId, operatorId, approve: true }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await membershipCount(admin)).toBe(1);
  });

  it("거절하면 모임이 생기지 않고 요청한 사람에게 「승인되지 않음」으로 남는다", async () => {
    const admin = await newAdmin("거절");
    const result = await requestGroupCreation({
      userId: admin,
      isOperator: false,
      name: `${TAG}-거절`,
    });
    if (result.status !== "PENDING") throw new Error("요청이 남지 않았다");

    const decided = await decideGroupCreationRequest({
      requestId: result.requestId,
      operatorId,
      approve: false,
    });
    expect(decided.groupId).toBeNull();
    expect(await membershipCount(admin)).toBe(0);
    expect((await readMyGroupRequests(admin)).map((r) => r.status)).toEqual(["REJECTED"]);
  });

  it("요청은 본인만 거둘 수 있고, 거둔 요청은 승인할 수 없다", async () => {
    const admin = await newAdmin("거둠");
    const other = await newAdmin("남");
    const result = await requestGroupCreation({
      userId: admin,
      isOperator: false,
      name: `${TAG}-거둠`,
    });
    if (result.status !== "PENDING") throw new Error("요청이 남지 않았다");

    await expect(
      cancelGroupCreationRequest({ userId: other, requestId: result.requestId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await cancelGroupCreationRequest({ userId: admin, requestId: result.requestId });
    expect(await readMyGroupRequests(admin)).toEqual([]);

    await expect(
      decideGroupCreationRequest({ requestId: result.requestId, operatorId, approve: true }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await membershipCount(admin)).toBe(0);
  });

  it("기다리는 요청도 모임 수 상한에 들어간다", async () => {
    const admin = await newAdmin("상한");
    for (let i = 0; i < MAX_GROUPS_PER_ADMIN; i += 1) {
      const result = await requestGroupCreation({
        userId: admin,
        isOperator: false,
        name: `${TAG}-상한${i}`,
      });
      expect(result.status).toBe("PENDING");
    }
    await expect(
      requestGroupCreation({ userId: admin, isOperator: false, name: `${TAG}-넘침` }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("승인 순간에 상한을 넘으면 모임을 만들지 않고 요청도 그대로 둔다", async () => {
    // 요청을 받을 때도 상한을 보므로 보통은 생기지 않는 상황이다. 상한이 줄었거나
    // 요청이 먼저 쌓여 있던 경우를 흉내 내려고 요청 행을 직접 넣는다.
    const admin = await newAdmin("꽉참");
    for (let i = 0; i < MAX_GROUPS_PER_ADMIN; i += 1) {
      await createGroupForAdmin({ userId: admin, name: `${TAG}-찬${i}` });
    }
    const requestId = await withOwner(async (sql) => {
      const r = await sql.query<{ id: string }>(
        `INSERT INTO group_creation_requests (requested_by, name) VALUES ($1, $2) RETURNING id`,
        [admin, `${TAG}-꽉참`],
      );
      return r.rows[0]!.id;
    });

    await expect(
      decideGroupCreationRequest({ requestId, operatorId, approve: true }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await membershipCount(admin)).toBe(MAX_GROUPS_PER_ADMIN);
    expect((await readMyGroupRequests(admin)).map((r) => r.status)).toEqual(["PENDING"]);
  });
});

describe("초대 코드 여러 번 쓰기", () => {
  let owner = "";
  let groupId = "";

  beforeAll(async () => {
    await updateOperatorSettings({ operatorId, groupCreationRequiresApproval: false });
    owner = await newAdmin("코드주인");
    ({ groupId } = await createGroupForAdmin({ userId: owner, name: `${TAG}-코드` }));
  });

  it("꺼져 있으면 1회용이다", async () => {
    await updateOperatorSettings({ operatorId, groupInviteReusable: false });
    const issued = await issueGroupInvite({ groupId, createdBy: owner });
    expect(issued.reusable).toBe(false);
    await consumeGroupInvite({ code: issued.code, userId: await newAdmin("한번") });
    await expect(
      consumeGroupInvite({ code: issued.code, userId: await newAdmin("두번") }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("켜져 있을 때 발급한 코드는 여러 명이 쓰고, 쓴 횟수를 센다", async () => {
    await updateOperatorSettings({ operatorId, groupInviteReusable: true });
    const issued = await issueGroupInvite({ groupId, createdBy: owner });
    expect(issued.reusable).toBe(true);
    const joiners = [await newAdmin("여럿1"), await newAdmin("여럿2"), await newAdmin("여럿3")];
    for (const userId of joiners) await consumeGroupInvite({ code: issued.code, userId });
    for (const userId of joiners) expect(await membershipCount(userId)).toBe(1);
    const row = await withOwner((sql) =>
      sql.query<{ use_count: number }>(
        `SELECT use_count FROM group_invite_codes
          WHERE group_id = $1 AND reusable ORDER BY created_at DESC LIMIT 1`,
        [groupId],
      ),
    );
    expect(row.rows[0]?.use_count).toBe(3);
  });

  it("켜도 이미 나간 1회용 코드는 1회용으로 남는다", async () => {
    await updateOperatorSettings({ operatorId, groupInviteReusable: false });
    const issued = await issueGroupInvite({ groupId, createdBy: owner });
    await updateOperatorSettings({ operatorId, groupInviteReusable: true });
    await consumeGroupInvite({ code: issued.code, userId: await newAdmin("소급1") });
    await expect(
      consumeGroupInvite({ code: issued.code, userId: await newAdmin("소급2") }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("끄면 이미 쓰인 여러 번 코드는 그 순간 막힌다", async () => {
    await updateOperatorSettings({ operatorId, groupInviteReusable: true });
    const issued = await issueGroupInvite({ groupId, createdBy: owner });
    await consumeGroupInvite({ code: issued.code, userId: await newAdmin("끄기전") });
    await updateOperatorSettings({ operatorId, groupInviteReusable: false });
    await expect(
      consumeGroupInvite({ code: issued.code, userId: await newAdmin("끈뒤") }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("새로 발급하면 이미 쓰인 여러 번 코드도 더는 쓸 수 없다", async () => {
    await updateOperatorSettings({ operatorId, groupInviteReusable: true });
    const first = await issueGroupInvite({ groupId, createdBy: owner });
    await consumeGroupInvite({ code: first.code, userId: await newAdmin("이전코드") });
    const second = await issueGroupInvite({ groupId, createdBy: owner });
    await expect(
      consumeGroupInvite({ code: first.code, userId: await newAdmin("이전코드2") }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await consumeGroupInvite({ code: second.code, userId: await newAdmin("새코드") });
  });
});

describe("런타임 롤", () => {
  it("관리자 설정을 읽지도 고치지도 못한다", async () => {
    const admin = await newAdmin("롤");
    await expect(
      withRls({ userId: admin, role: "ADMIN" }, (sql) =>
        sql.query(`SELECT * FROM operator_settings`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withRls({ userId: admin, role: "ADMIN" }, (sql) =>
        sql.query(`UPDATE operator_settings SET group_creation_requires_approval = false`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("모임 만들기 요청을 읽거나 스스로 승인하지 못한다", async () => {
    const admin = await newAdmin("롤2");
    await expect(
      withRls({ userId: admin, role: "ADMIN" }, (sql) =>
        sql.query(`SELECT * FROM group_creation_requests`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withRls({ userId: admin, role: "ADMIN" }, (sql) =>
        sql.query(
          `INSERT INTO group_creation_requests (requested_by, name, status, decided_at)
           VALUES ($1, $2, 'APPROVED', now())`,
          [admin, `${TAG}-몰래`],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
