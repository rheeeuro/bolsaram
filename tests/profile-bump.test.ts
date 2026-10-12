/**
 * 프로필 끌어올리기 (0062).
 *
 * 지키는 성질:
 * - **등록한 주선자만** 끌어올린다. 같은 모임 동료는 앱에서도 RLS 에서도 막힌다.
 * - 끌어올린 프로필이 목록 맨 앞에 선다(같은 사진 유무 안에서).
 * - 모임 채팅방에 공개 번호와 주선자 이름만 담은 한 줄이 남는다. 작성자는 끌어올린
 *   사람이라 그 사람의 배지에는 뜨지 않는다.
 * - 활성 프로필만, 24시간에 한 번. DB 트리거가 앱을 우회한 값(미래 시각·되돌리기)을 막는다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withOwner, withRls, type RlsContext } from "@bolsaram/db";
import {
  PROFILE_BUMP_COOLDOWN_HOURS,
  bumpBlockedReason,
  isDomainError,
  nextBumpAt,
} from "@bolsaram/domain";
import { adminProfileQuerySchema } from "@bolsaram/schemas";
import { listMessages } from "../apps/web/src/server/repo/group-chat";
import {
  assertCanEditProfile,
  bumpProfile,
  findAdminProfiles,
} from "../apps/web/src/server/repo/profiles";
import { runTag } from "./tags";

describe("끌어올리기 판정 (도메인)", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

  it("한 번도 안 했으면 바로 할 수 있다", () => {
    expect(nextBumpAt(null)).toBeNull();
    expect(bumpBlockedReason({ status: "ACTIVE", bumpedAt: null }, now)).toBeNull();
  });

  it("기다리는 시간 안에서는 막고, 지나면 연다", () => {
    const recent = hoursAgo(PROFILE_BUMP_COOLDOWN_HOURS - 1);
    expect(bumpBlockedReason({ status: "ACTIVE", bumpedAt: recent }, now)).not.toBeNull();
    expect(nextBumpAt(recent)!.getTime()).toBe(
      recent.getTime() + PROFILE_BUMP_COOLDOWN_HOURS * 60 * 60 * 1000,
    );
    const old = hoursAgo(PROFILE_BUMP_COOLDOWN_HOURS);
    expect(bumpBlockedReason({ status: "ACTIVE", bumpedAt: old }, now)).toBeNull();
  });

  it("비활성 프로필은 막는다 — 멤버에게 보이는 곳이 없다", () => {
    expect(bumpBlockedReason({ status: "INACTIVE", bumpedAt: null }, now)).not.toBeNull();
  });
});

const TAG = runTag("bump");
let owner: RlsContext;
let peer: RlsContext;
let groupId: string;
let older: { id: string; code: number };
let newer: { id: string; code: number };
let inactiveId: string;

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

    // 등록 시각을 벌려 둔다 — 같은 트랜잭션의 now() 는 같아서 순서가 id 로만 갈린다.
    const profile = async (status: string, daysAgo: number) => {
      const p = await sql.query<{ id: string; public_code: number }>(
        `INSERT INTO profiles (group_id, gender, birth_year, residence_region, created_by, status, created_at)
         VALUES ($1, 'FEMALE', 1993, 'SEOUL', $2, $3, now() - make_interval(days => $4))
         RETURNING id, public_code`,
        [group, ownerId, status, daysAgo],
      );
      return { id: p.rows[0]!.id, code: p.rows[0]!.public_code };
    };
    return {
      group,
      ownerId,
      peerId,
      older: await profile("ACTIVE", 2),
      newer: await profile("ACTIVE", 1),
      inactive: await profile("INACTIVE", 3),
    };
  });

  groupId = fixture.group;
  owner = { userId: fixture.ownerId, role: "ADMIN" };
  peer = { userId: fixture.peerId, role: "ADMIN" };
  older = fixture.older;
  newer = fixture.newer;
  inactiveId = fixture.inactive.id;
});

afterAll(async () => {
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM profiles WHERE group_id = $1`, [groupId]);
    await sql.query(`DELETE FROM groups WHERE id = $1`, [groupId]);
    await sql.query(`DELETE FROM users WHERE display_name LIKE $1`, [`${TAG}%`]);
  });
  await closePools();
});

async function orderInGroup(ctx: RlsContext): Promise<string[]> {
  const page = await withRls(ctx, (sql) =>
    findAdminProfiles(sql, adminProfileQuerySchema.parse({ status: "ACTIVE" }), { groupId }),
  );
  return page.items.map((p) => p.id);
}

async function bumpedMessages() {
  const all = await withRls(owner, (sql) => listMessages(sql, groupId, { limit: 100 }));
  return all.filter((m) => m.systemKind === "PROFILE_BUMPED");
}

async function bumpedAtOf(id: string): Promise<Date | null> {
  return withOwner(async (sql) => {
    const r = await sql.query<{ bumped_at: Date | null }>(
      `SELECT bumped_at FROM profiles WHERE id = $1`,
      [id],
    );
    return r.rows[0]!.bumped_at;
  });
}

describe("끌어올리기 — 막히는 것", () => {
  it("같은 모임 동료는 앱 판정에서 막힌다", async () => {
    await expect(
      withRls(peer, (sql) => assertCanEditProfile(sql, older.id)),
    ).rejects.toSatisfy((e) => isDomainError(e) && e.code === "FORBIDDEN");
  });

  it("동료가 직접 UPDATE 해도 RLS 가 0건으로 만든다", async () => {
    const r = await withRls(peer, (sql) =>
      sql.query(`UPDATE profiles SET bumped_at = now() WHERE id = $1`, [older.id]),
    );
    expect(r.rowCount).toBe(0);
    expect(await bumpedAtOf(older.id)).toBeNull();
  });

  it("비활성 프로필은 끌어올리지 못한다", async () => {
    await expect(withRls(owner, (sql) => bumpProfile(sql, inactiveId))).rejects.toSatisfy(
      (e) => isDomainError(e) && e.code === "CONFLICT",
    );
    // 앱을 건너뛰어도 트리거가 막는다.
    await expect(
      withRls(owner, (sql) =>
        sql.query(`UPDATE profiles SET bumped_at = now() WHERE id = $1`, [inactiveId]),
      ),
    ).rejects.toThrow();
  });

  it("지금이 아닌 시각은 넣을 수 없다 — 미래 시각이면 영원히 맨 앞이다", async () => {
    await expect(
      withRls(owner, (sql) =>
        sql.query(`UPDATE profiles SET bumped_at = now() + interval '1 year' WHERE id = $1`, [
          newer.id,
        ]),
      ),
    ).rejects.toThrow();
    expect(await bumpedAtOf(newer.id)).toBeNull();
  });
});

describe("끌어올리기 — 등록한 주선자", () => {
  it("끌어올리기 전에는 최근 등록이 앞이다", async () => {
    const order = await orderInGroup(owner);
    expect(order.indexOf(newer.id)).toBeLessThan(order.indexOf(older.id));
  });

  it("끌어올린 프로필이 맨 앞에 서고, 동료의 목록에서도 그렇다", async () => {
    const bumpedAt = await withRls(owner, (sql) => bumpProfile(sql, older.id));
    expect(bumpedAt).toBeInstanceOf(Date);

    expect((await orderInGroup(owner))[0]).toBe(older.id);
    expect((await orderInGroup(peer))[0]).toBe(older.id);
  });

  it("모임 채팅방에 번호와 주선자 이름만 남고, 작성자는 끌어올린 사람이다", async () => {
    const messages = await bumpedMessages();
    expect(messages).toHaveLength(1);
    const message = messages[0]!;
    expect(message.payload.profileCode).toBe(older.code);
    expect(message.payload.actorName).toBe(`${TAG}a`);
    expect(message.authorUserId).toBe(owner.userId);
    expect(message.profileIds).toEqual({ [String(older.code)]: older.id });
  });

  it("24시간 안에 다시 하면 막히고, 방에 줄이 늘지 않는다", async () => {
    await expect(withRls(owner, (sql) => bumpProfile(sql, older.id))).rejects.toSatisfy(
      (e) => isDomainError(e) && e.code === "CONFLICT",
    );
    // 앱을 건너뛰어도 트리거가 같은 기준으로 막는다.
    await expect(
      withRls(owner, (sql) =>
        sql.query(`UPDATE profiles SET bumped_at = now() WHERE id = $1`, [older.id]),
      ),
    ).rejects.toThrow();
    expect(await bumpedMessages()).toHaveLength(1);
  });

  it("끌어올린 기록은 지울 수 없다", async () => {
    await expect(
      withRls(owner, (sql) =>
        sql.query(`UPDATE profiles SET bumped_at = NULL WHERE id = $1`, [older.id]),
      ),
    ).rejects.toThrow();
  });

  it("다른 칸을 고쳐도 끌어올린 시각은 그대로다", async () => {
    const before = await bumpedAtOf(older.id);
    await withRls(owner, (sql) =>
      sql.query(`UPDATE profiles SET bio = '합성 소개' WHERE id = $1`, [older.id]),
    );
    expect((await bumpedAtOf(older.id))?.toISOString()).toBe(before?.toISOString());
  });
});
