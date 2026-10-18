/**
 * 주선자 「오늘 할 일」 개수 — 홈과 메뉴 배지가 함께 읽는다.
 *
 * 지키는 성질:
 * - **남의 일은 세지 않는다.** 확인 대기 요청·알릴 신청·초대할 멤버는 등록한 주선자의
 *   것만 센다. 같은 모임 동료나 모임 밖 주선자의 수에는 0 이 나온다(RLS 와 판정 함수).
 * - 확인 대기 요청은 보고 있는 채널과 무관하게 센다. 나머지는 그 채널 안의 것만 센다.
 * - 초대는 「안 보냄」과 「기한 지남」만 센다. 열 수 있는 초대를 보낸 분은 할 일이 아니다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withOwner, withRls, type RlsContext } from "@bolsaram/db";
import { countHostTodo } from "../apps/web/src/server/repo/host-todo";
import { runTag } from "./tags";

const TAG = runTag("todo");
let owner: RlsContext;
let peer: RlsContext;
let outsider: RlsContext;
let groupId: string;
let ownerSecondId: string;

beforeAll(async () => {
  const fixture = await withOwner(async (sql) => {
    const g = await sql.query<{ id: string }>(
      `INSERT INTO groups (name) VALUES ($1) RETURNING id`,
      [TAG],
    );
    const group = g.rows[0]!.id;
    const admin = async (n: string, member: boolean) => {
      const u = await sql.query<{ id: string }>(
        `INSERT INTO users (role, email, display_name) VALUES ('ADMIN', $1, $2) RETURNING id`,
        [`${TAG}-${n}@test.local`, `${TAG}${n}`],
      );
      if (member) {
        await sql.query(
          `INSERT INTO group_admins (group_id, user_id, is_owner) VALUES ($1, $2, $3)`,
          [group, u.rows[0]!.id, n === "a"],
        );
      }
      return u.rows[0]!.id;
    };
    const ownerId = await admin("a", true);
    const peerId = await admin("b", true);
    const outsiderId = await admin("c", false);

    const profile = async (gender: string, createdBy: string) => {
      const p = await sql.query<{ id: string }>(
        `INSERT INTO profiles (group_id, gender, birth_year, residence_region, created_by, status)
         VALUES ($1, $2, 1993, 'SEOUL', $3, 'ACTIVE') RETURNING id`,
        [group, gender, createdBy],
      );
      return p.rows[0]!.id;
    };
    const ownerFirst = await profile("MALE", ownerId);
    const ownerSecond = await profile("MALE", ownerId);
    const peerFirst = await profile("FEMALE", peerId);

    // 내 멤버가 동료의 멤버에게 보낸 마음 — 아직 주선자 확인 전이다.
    await sql.query(
      `INSERT INTO match_intents (profile_id, kind, target_profile_id) VALUES ($1, 'SEND', $2)`,
      [ownerFirst, peerFirst],
    );
    // 동료의 멤버가 내 멤버에게 보낸 신청 — 받는 쪽(내 담당)이 알려야 한다.
    await sql.query(
      `INSERT INTO match_requests (requester_profile_id, target_profile_id) VALUES ($1, $2)`,
      [peerFirst, ownerSecond],
    );
    return { group, ownerId, peerId, outsiderId, ownerSecond };
  });

  groupId = fixture.group;
  owner = { userId: fixture.ownerId, role: "ADMIN" };
  peer = { userId: fixture.peerId, role: "ADMIN" };
  outsider = { userId: fixture.outsiderId, role: "ADMIN" };
  ownerSecondId = fixture.ownerSecond;
});

afterAll(async () => {
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM profiles WHERE group_id = $1`, [groupId]);
    await sql.query(`DELETE FROM groups WHERE id = $1`, [groupId]);
    await sql.query(`DELETE FROM users WHERE display_name LIKE $1`, [`${TAG}%`]);
  });
  await closePools();
});

const count = (ctx: RlsContext, channel: string | null) =>
  withRls(ctx, (sql) => countHostTodo(sql, channel));

describe("오늘 할 일 — 막히는 것", () => {
  it("모임 밖 주선자에게는 아무것도 세지 않는다", async () => {
    expect(await count(outsider, groupId)).toEqual({
      intentsPending: 0,
      requestsToRelay: 0,
      importsPending: 0,
      invitesToSend: 0,
    });
  });

  it("같은 모임 동료에게 내 멤버의 요청·받은 신청은 세지 않는다", async () => {
    const todo = await count(peer, groupId);
    expect(todo.intentsPending).toBe(0);
    expect(todo.requestsToRelay).toBe(0);
    // 동료는 자기가 등록한 한 분만 초대할 수 있다.
    expect(todo.invitesToSend).toBe(1);
  });
});

describe("오늘 할 일 — 등록한 주선자", () => {
  it("내 멤버의 확인 대기 요청과 알릴 신청을 센다", async () => {
    const todo = await count(owner, groupId);
    expect(todo.intentsPending).toBe(1);
    expect(todo.requestsToRelay).toBe(1);
    expect(todo.invitesToSend).toBe(2);
  });

  it("확인 대기 요청만 다른 채널을 볼 때도 센다", async () => {
    const todo = await count(owner, null);
    expect(todo.intentsPending).toBe(1);
    expect(todo.requestsToRelay).toBe(0);
    expect(todo.invitesToSend).toBe(0);
  });

  it("열 수 있는 초대를 보낸 분은 빠지고, 기한이 지나면 다시 센다", async () => {
    await withOwner((sql) =>
      sql.query(
        `INSERT INTO invites (profile_id, token_hash, expires_at, created_by)
         VALUES ($1, $2, now() + interval '72 hours', $3)`,
        [ownerSecondId, `${TAG}-open`, owner.userId],
      ),
    );
    expect((await count(owner, groupId)).invitesToSend).toBe(1);

    await withOwner((sql) =>
      sql.query(`UPDATE invites SET expires_at = now() - interval '1 hour' WHERE token_hash = $1`, [
        `${TAG}-open`,
      ]),
    );
    expect((await count(owner, groupId)).invitesToSend).toBe(2);
  });
});
