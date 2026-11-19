/**
 * 보류한 요청 되돌리기 — 보류는 영구 차단이 아니다(0030).
 *
 * 지키는 성질:
 * - 등록한 주선자만 되돌린다. 같은 모임 동료에게는 행이 보이지 않아 되돌릴 수 없다(RLS).
 * - 되돌리면 확인 대기로 돌아가고 처리 기록(누가·언제·왜)이 비워진다.
 * - 되돌리면 요청한 멤버의 목록에 그 상대가 다시 보인다.
 * - 그사이 같은 요청이 다시 들어와 대기 중이면 되돌리지 않는다(대기 하나 규칙).
 * - 되돌린 요청을 다시 보류해도 알림 중복 방지에 걸려 실패하지 않는다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withOwner, withRls, type RlsContext } from "@bolsaram/db";
import {
  decideIntent,
  listDeclinedIntents,
  reopenIntent,
} from "../apps/web/src/server/repo/match-intents";
import { runTag } from "./tags";

const TAG = runTag("reopen");
let owner: RlsContext;
let peer: RlsContext;
let groupId: string;
let fromId: string;
let toId: string;
let ownerUserId: string;

beforeAll(async () => {
  const fixture = await withOwner(async (sql) => {
    const g = await sql.query<{ id: string }>(
      `INSERT INTO groups (name) VALUES ($1) RETURNING id`,
      [TAG],
    );
    const group = g.rows[0]!.id;
    const admin = async (n: string) => {
      const u = await sql.query<{ id: string }>(
        `INSERT INTO users (role, email, display_name) VALUES ('ADMIN', $1, $2) RETURNING id`,
        [`${TAG}-${n}@test.local`, `${TAG}${n}`],
      );
      await sql.query(
        `INSERT INTO group_admins (group_id, user_id, is_owner) VALUES ($1, $2, $3)`,
        [group, u.rows[0]!.id, n === "a"],
      );
      return u.rows[0]!.id;
    };
    const ownerId = await admin("a");
    const peerId = await admin("b");

    const profile = async (gender: string, createdBy: string) => {
      const p = await sql.query<{ id: string }>(
        `INSERT INTO profiles (group_id, gender, birth_year, residence_region, created_by, status)
         VALUES ($1, $2, 1993, 'SEOUL', $3, 'ACTIVE') RETURNING id`,
        [group, gender, createdBy],
      );
      return p.rows[0]!.id;
    };
    const from = await profile("MALE", ownerId);
    const to = await profile("FEMALE", peerId);
    return { group, ownerId, peerId, from, to };
  });

  groupId = fixture.group;
  ownerUserId = fixture.ownerId;
  owner = { userId: fixture.ownerId, role: "ADMIN" };
  peer = { userId: fixture.peerId, role: "ADMIN" };
  fromId = fixture.from;
  toId = fixture.to;
});

afterAll(async () => {
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM profiles WHERE group_id = $1`, [groupId]);
    await sql.query(`DELETE FROM groups WHERE id = $1`, [groupId]);
    await sql.query(`DELETE FROM users WHERE display_name LIKE $1`, [`${TAG}%`]);
  });
  await closePools();
});

/** 보류된 「마음 보내기」 하나를 만든다. 큐에서 주선자가 보류를 누른 것과 같다. */
async function declinedSend(): Promise<string> {
  const id = await withOwner(async (sql) => {
    const r = await sql.query<{ id: string }>(
      `INSERT INTO match_intents (profile_id, kind, target_profile_id)
       VALUES ($1, 'SEND', $2) RETURNING id`,
      [fromId, toId],
    );
    return r.rows[0]!.id;
  });
  await withRls(owner, (sql) =>
    decideIntent(sql, {
      id,
      status: "DECLINED",
      decidedBy: ownerUserId,
      declineReason: "지금은 아님",
    }),
  );
  return id;
}

/** 요청한 멤버의 목록에서 빠지는 상대들. 주선자가 그 멤버로 둘러보는 자리다. */
async function hiddenFromMember(): Promise<string[]> {
  return withRls({ ...owner, actingProfileId: fromId }, async (sql) => {
    const r = await sql.query<{ id: string }>(
      `SELECT app_discover_excluded_profile_ids() AS id`,
    );
    return r.rows.map((row) => row.id);
  });
}

async function clearIntents() {
  await withOwner((sql) =>
    sql.query(`DELETE FROM match_intents WHERE profile_id = $1`, [fromId]),
  );
}

describe("보류한 요청 되돌리기", () => {
  it("동료에게는 보류한 요청이 보이지 않고 되돌릴 수도 없다", async () => {
    await clearIntents();
    const id = await declinedSend();

    const seen = await withRls(peer, (sql) => listDeclinedIntents(sql));
    expect(seen.map((i) => i.id)).not.toContain(id);
    await expect(withRls(peer, (sql) => reopenIntent(sql, id))).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("등록한 주선자가 되돌리면 확인 대기로 돌아가고 처리 기록이 비워진다", async () => {
    await clearIntents();
    const id = await declinedSend();

    const listed = await withRls(owner, (sql) => listDeclinedIntents(sql));
    expect(listed.map((i) => i.id)).toContain(id);
    expect(await hiddenFromMember()).toContain(toId);

    const reopened = await withRls(owner, (sql) => reopenIntent(sql, id));
    expect(reopened.status).toBe("PENDING");
    expect(reopened.decidedAt).toBeNull();
    expect(reopened.declineReason).toBeNull();

    expect(await hiddenFromMember()).not.toContain(toId);
    const after = await withRls(owner, (sql) => listDeclinedIntents(sql));
    expect(after.map((i) => i.id)).not.toContain(id);
  });

  it("이미 대기 중인 요청은 되돌릴 대상이 아니다", async () => {
    await clearIntents();
    const id = await declinedSend();
    await withRls(owner, (sql) => reopenIntent(sql, id));
    await expect(withRls(owner, (sql) => reopenIntent(sql, id))).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("같은 상대에게 새 요청이 대기 중이면 되돌리지 않는다", async () => {
    await clearIntents();
    const id = await declinedSend();
    await withOwner((sql) =>
      sql.query(
        `INSERT INTO match_intents (profile_id, kind, target_profile_id) VALUES ($1, 'SEND', $2)`,
        [fromId, toId],
      ),
    );
    await expect(withRls(owner, (sql) => reopenIntent(sql, id))).rejects.toMatchObject({
      code: "CONFLICT",
      message: "같은 요청이 이미 확인을 기다리고 있습니다.",
    });
  });

  it("되돌린 요청을 다시 보류할 수 있다", async () => {
    await clearIntents();
    const id = await declinedSend();
    await withRls(owner, (sql) => reopenIntent(sql, id));
    const again = await withRls(owner, (sql) =>
      decideIntent(sql, { id, status: "DECLINED", decidedBy: ownerUserId }),
    );
    expect(again.status).toBe("DECLINED");
    expect(again.decidedAt).not.toBeNull();
  });
});
