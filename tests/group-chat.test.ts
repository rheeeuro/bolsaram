/**
 * 모임 채팅방 통합 테스트 (마이그레이션 0040).
 *
 * 방의 경계는 모임이고 참여자 명단은 `group_admins` 다. 여기서 지키는 성질 —
 * 대부분 "안 되는 것"이다.
 *   * 같은 모임 주선자끼리만 읽고 쓴다. 다른 모임도 멤버도 들어오지 못한다.
 *   * 남의 이름으로 쓸 수 없다.
 *   * 쓴 글은 고칠 수 없다. 지우기만 되고, 그것도 자기 것만이다.
 *   * 지운 글의 본문은 DB 에도 남지 않는다.
 *   * 알림은 켜 둔 사람에게만 가고, 쓴 사람에게는 가지 않는다.
 *   * 아직 보내지 않은 알림이 있으면 새 글이 와도 하나로 접힌다.
 *   * 계정이 지워져도 대화는 남는다(0041).
 *   * 새 글과 지움이 `LISTEN/NOTIFY` 로 알려지고, 그 payload 에 본문이 없다(0043).
 *   * 모임의 사건이 시스템 메시지로 남고, 사람은 그것을 만들지도 지우지도 못한다(0044).
 *   * 시스템 메시지의 공개 번호는 볼 수 있을 때만 프로필 id 로 풀린다(화면의 링크).
 *   * 나중에 합류한 주선자에게는 **들어오기 전 대화가 보이지 않는다**(0045).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, listen, withOwner, withRls, type RlsContext, type Sql } from "@bolsaram/db";
import { groupChatNotifySchema } from "@bolsaram/schemas";
import {
  createMessage,
  deleteMessage,
  listMessages,
  readMessage,
  unreadByGroup,
  updatePrefs,
} from "../apps/web/src/server/repo/group-chat";

const TAG = `chattest-${Date.now()}`;

type Party = {
  groupId: string;
  ownerId: string;
  owner: RlsContext;
  /** 같은 모임의 동료 주선자. 알림과 읽음을 보는 쪽이다. */
  peerId: string;
  peer: RlsContext;
  member: RlsContext;
};

let A: Party;
let B: Party;

async function makeParty(sql: Sql, key: string): Promise<Party> {
  const g = await sql.query<{ id: string }>(`INSERT INTO groups (name) VALUES ($1) RETURNING id`, [
    `${TAG}-${key}`,
  ]);
  const groupId = g.rows[0]!.id;

  const admin = async (suffix: string, isOwner: boolean) => {
    const r = await sql.query<{ id: string }>(
      `INSERT INTO users (role, email, display_name)
       VALUES ('ADMIN', $1, $2) RETURNING id`,
      [`${TAG}-${key}-${suffix}@test.local`, `${TAG}-${key}-${suffix}`],
    );
    const id = r.rows[0]!.id;
    await sql.query(
      `INSERT INTO group_admins (group_id, user_id, is_owner) VALUES ($1, $2, $3)`,
      [groupId, id, isOwner],
    );
    return id;
  };

  const ownerId = await admin("owner", true);
  const peerId = await admin("peer", false);

  const m = await sql.query<{ id: string }>(
    `INSERT INTO users (role, phone, display_name) VALUES ('MEMBER', $1, $2) RETURNING id`,
    [`0108${String(Date.now()).slice(-5)}${key === "a" ? "1" : "2"}`, `${TAG}-${key}-member`],
  );
  const memberId = m.rows[0]!.id;
  await sql.query(
    `INSERT INTO profiles (group_id, user_id, gender, birth_year, residence_region,
                           status, visibility, real_name, created_by)
     VALUES ($1, $2, 'FEMALE', 1993, 'SEOUL', 'ACTIVE', 'LISTED', $3, $4)`,
    [groupId, memberId, `${TAG}-${key}-이름`, ownerId],
  );

  return {
    groupId,
    ownerId,
    owner: { userId: ownerId, role: "ADMIN" },
    peerId,
    peer: { userId: peerId, role: "ADMIN" },
    member: { userId: memberId, role: "MEMBER" },
  };
}

beforeAll(async () => {
  const parties = await withOwner(async (sql) => ({
    a: await makeParty(sql, "a"),
    b: await makeParty(sql, "b"),
  }));
  A = parties.a;
  B = parties.b;
});

afterAll(async () => {
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM profiles WHERE real_name LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM users WHERE display_name LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM groups WHERE name LIKE $1`, [`${TAG}%`]);
  });
  await closePools();
});

/** owner 커넥션으로 한 줄 넣는다. 정책을 보지 않는 픽스처용 경로다. */
async function seedMessage(groupId: string, authorId: string, body: string): Promise<string> {
  return withOwner(async (sql) => {
    const r = await sql.query<{ id: string }>(
      `INSERT INTO group_messages (group_id, author_user_id, body)
       VALUES ($1, $2, $3) RETURNING id`,
      [groupId, authorId, body],
    );
    return r.rows[0]!.id;
  });
}

describe("방은 모임 안에서만 열린다", () => {
  it("같은 모임 주선자는 읽고 쓴다", async () => {
    const written = await withRls(A.owner, (sql) =>
      createMessage(sql, A.groupId, A.ownerId, "오늘 검토할 프로필 3건"),
    );
    expect(written.body).toBe("오늘 검토할 프로필 3건");

    const seen = await withRls(A.peer, (sql) =>
      listMessages(sql, A.groupId, { limit: 50 }),
    );
    expect(seen.map((m) => m.id)).toContain(written.id);
  });

  it("다른 모임 주선자는 읽지 못한다", async () => {
    await seedMessage(A.groupId, A.ownerId, `${TAG}-secret`);
    const seen = await withRls(B.owner, (sql) => listMessages(sql, A.groupId, { limit: 50 }));
    expect(seen).toHaveLength(0);
  });

  it("다른 모임에는 쓰지 못한다", async () => {
    await expect(
      withRls(B.owner, (sql) => createMessage(sql, A.groupId, B.ownerId, "여기 써진다면 문제")),
    ).rejects.toThrow();
  });

  it("멤버는 방을 읽지 못한다", async () => {
    const seen = await withRls(A.member, async (sql) => {
      const r = await sql.query(`SELECT id FROM group_messages WHERE group_id = $1`, [A.groupId]);
      return r.rowCount ?? 0;
    });
    expect(seen).toBe(0);
  });

  it("남의 이름으로 쓰지 못한다", async () => {
    await expect(
      withRls(A.owner, (sql) =>
        sql.query(
          `INSERT INTO group_messages (group_id, author_user_id, body) VALUES ($1, $2, $3)`,
          [A.groupId, A.peerId, "동료가 쓴 것처럼"],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("쓴 글은 고칠 수 없다", () => {
  it("본문을 수정하지 못한다", async () => {
    const id = await seedMessage(A.groupId, A.ownerId, `${TAG}-원문`);
    await expect(
      withRls(A.owner, (sql) =>
        sql.query(`UPDATE group_messages SET body = '바뀐 내용' WHERE id = $1`, [id]),
      ),
    ).rejects.toThrow();
  });

  it("남의 메시지는 지우지 못한다", async () => {
    const id = await seedMessage(A.groupId, A.peerId, `${TAG}-동료 글`);
    await expect(
      withRls(A.owner, (sql) => deleteMessage(sql, A.groupId, id)),
    ).rejects.toThrow();
  });

  it("내 메시지를 지우면 본문이 DB 에서도 사라진다", async () => {
    const id = await seedMessage(A.groupId, A.ownerId, `${TAG}-지울 글`);
    await withRls(A.owner, (sql) => deleteMessage(sql, A.groupId, id));

    const stored = await withOwner(async (sql) => {
      const r = await sql.query<{ body: string; deleted_at: Date | null }>(
        `SELECT body, deleted_at FROM group_messages WHERE id = $1`,
        [id],
      );
      return r.rows[0]!;
    });
    expect(stored.body).toBe("");
    expect(stored.deleted_at).not.toBeNull();
  });

  it("계정이 지워져도 대화는 남고 작성자만 비워진다", async () => {
    const party = await withOwner((sql) => makeParty(sql, `x${Date.now() % 100000}`));
    const id = await seedMessage(party.groupId, party.peerId, `${TAG}-떠난 사람의 글`);

    // 계정 삭제는 FK 의 ON DELETE SET NULL 로 이 메시지를 UPDATE 한다 — 0040 의
    // 가드가 그것까지 막아서 계정을 지울 수 없었다(0041 에서 그 경로만 열었다).
    await withOwner((sql) => sql.query(`DELETE FROM users WHERE id = $1`, [party.peerId]));

    const stored = await withOwner(async (sql) => {
      const r = await sql.query<{ author_user_id: string | null; body: string }>(
        `SELECT author_user_id, body FROM group_messages WHERE id = $1`,
        [id],
      );
      return r.rows[0]!;
    });
    expect(stored.author_user_id).toBeNull();
    expect(stored.body).toContain("떠난 사람의 글");
  });

  it("행 자체를 지우지는 못한다", async () => {
    const id = await seedMessage(A.groupId, A.ownerId, `${TAG}-남는 글`);
    const deleted = await withRls(A.owner, async (sql) => {
      const r = await sql.query(`DELETE FROM group_messages WHERE id = $1`, [id]);
      return r.rowCount ?? 0;
    });
    expect(deleted).toBe(0);
  });
});

describe("안 읽은 개수", () => {
  /**
   * 화면이 들고 있는 커서는 JSON 을 거친 ISO 문자열이라 밀리초까지다. 저장 정밀도가
   * 그보다 잘면 마지막 한 줄이 영원히 안 읽음으로 남는다 — 0042 가 맞춘 성질이다.
   */
  it("마지막 메시지의 시각을 그대로 보내면 남김없이 읽힌다", async () => {
    const party = await withOwner((sql) => makeParty(sql, `m${Date.now() % 100000}`));
    await seedMessage(party.groupId, party.ownerId, `${TAG}-커서`);

    const seen = await withRls(party.peer, (sql) =>
      listMessages(sql, party.groupId, { limit: 50 }),
    );
    const cursor = seen[seen.length - 1]!.createdAt.toISOString();
    await withRls(party.peer, (sql) =>
      updatePrefs(sql, party.groupId, party.peerId, { readUpTo: cursor }),
    );

    const after = await withRls(party.peer, (sql) => unreadByGroup(sql, party.peerId));
    expect(after.find((g) => g.groupId === party.groupId)?.unread).toBe(0);
  });

  /** 방을 만들면 시스템 메시지(입장·멤버 등록)가 먼저 쌓인다 — 늘어난 만큼을 본다. */
  async function unreadOf(ctx: RlsContext, userId: string, groupId: string): Promise<number> {
    const rows = await withRls(ctx, (sql) => unreadByGroup(sql, userId));
    return rows.find((g) => g.groupId === groupId)?.unread ?? 0;
  }

  it("내가 쓴 것과 읽은 것은 세지 않는다", async () => {
    const party = await withOwner((sql) => makeParty(sql, `u${Date.now() % 100000}`));
    const base = await unreadOf(party.peer, party.peerId, party.groupId);

    await seedMessage(party.groupId, party.ownerId, `${TAG}-1`);
    await seedMessage(party.groupId, party.ownerId, `${TAG}-2`);
    expect(await unreadOf(party.peer, party.peerId, party.groupId)).toBe(base + 2);

    // 쓴 사람에게는 자기 글이 세어지지 않는다.
    const authorBefore = await unreadOf(party.owner, party.ownerId, party.groupId);
    await seedMessage(party.groupId, party.ownerId, `${TAG}-3`);
    expect(await unreadOf(party.owner, party.ownerId, party.groupId)).toBe(authorBefore);

    await withRls(party.peer, (sql) =>
      updatePrefs(sql, party.groupId, party.peerId, { readUpTo: new Date().toISOString() }),
    );
    expect(await unreadOf(party.peer, party.peerId, party.groupId)).toBe(0);
  });
});

/**
 * 실시간 전달의 뿌리 (0043). 이것이 조용히 깨지면 화면이 영영 갱신되지 않는다 —
 * 폴링을 걷어냈기 때문에 대신 메워 줄 것이 없다.
 */
describe("들어온 시점부터 보인다", () => {
  /** 먼저 있던 주선자 하나로 방을 만들고, 말이 오간 뒤에 새 주선자를 들인다. */
  async function roomWithHistory(key: string) {
    const party = await withOwner((sql) => makeParty(sql, key));
    const before = await withRls(party.owner, (sql) =>
      createMessage(sql, party.groupId, party.ownerId, `${TAG}-오기 전에 오간 말`),
    );

    const latecomerId = await withOwner(async (sql) => {
      const u = await sql.query<{ id: string }>(
        `INSERT INTO users (role, email, display_name)
         VALUES ('ADMIN', $1, $2) RETURNING id`,
        [`${TAG}-${key}-late@test.local`, `${TAG}-${key}-late`],
      );
      const id = u.rows[0]!.id;
      await sql.query(
        `INSERT INTO group_admins (group_id, user_id, is_owner) VALUES ($1, $2, false)`,
        [party.groupId, id],
      );
      return id;
    });

    return {
      ...party,
      before,
      latecomerId,
      latecomer: { userId: latecomerId, role: "ADMIN" } as RlsContext,
    };
  }

  it("합류 전 대화는 보이지 않는다", async () => {
    const room = await roomWithHistory(`l${Date.now() % 100000}`);

    const seen = await withRls(room.latecomer, (sql) =>
      listMessages(sql, room.groupId, { limit: 100 }),
    );
    expect(seen.map((m) => m.id)).not.toContain(room.before.id);
    // 먼저 있던 사람에게는 그대로 보인다.
    const owner = await withRls(room.owner, (sql) =>
      listMessages(sql, room.groupId, { limit: 100 }),
    );
    expect(owner.map((m) => m.id)).toContain(room.before.id);
  });

  it("자기 입장 기록이 첫 줄이다", async () => {
    const room = await roomWithHistory(`f${Date.now() % 100000}`);

    const seen = await withRls(room.latecomer, (sql) =>
      listMessages(sql, room.groupId, { limit: 100 }),
    );
    expect(seen.length).toBeGreaterThan(0);
    // 정밀도가 어긋나면 자기 입장 기록이 자기 기준보다 이르다고 판정되어 빠진다(0045).
    expect(seen[0]!.systemKind).toBe("ADMIN_JOINED");
    expect(seen[0]!.payload.actorName).toContain("-late");
  });

  it("합류 뒤의 말은 보인다", async () => {
    const room = await roomWithHistory(`a${Date.now() % 100000}`);
    const after = await withRls(room.owner, (sql) =>
      createMessage(sql, room.groupId, room.ownerId, `${TAG}-온 뒤에 오간 말`),
    );

    const seen = await withRls(room.latecomer, (sql) =>
      listMessages(sql, room.groupId, { limit: 100 }),
    );
    expect(seen.map((m) => m.id)).toContain(after.id);
  });

  it("합류 전 것은 안 읽은 수에도 들어가지 않는다", async () => {
    const room = await roomWithHistory(`u${Date.now() % 100000}`);

    const rows = await withRls(room.latecomer, (sql) => unreadByGroup(sql, room.latecomerId));
    const unread = rows.find((g) => g.groupId === room.groupId)?.unread ?? 0;
    const visible = await withRls(room.latecomer, (sql) =>
      listMessages(sql, room.groupId, { limit: 100 }),
    );
    // 볼 수 있는 것만 센다 — 목록과 배지가 같은 기준을 쓴다.
    expect(unread).toBe(visible.filter((m) => m.authorUserId !== room.latecomerId).length);
  });

  it("스트림도 같은 기준으로 막힌다", async () => {
    const room = await roomWithHistory(`s${Date.now() % 100000}`);

    // 스트림은 사건을 받고 이 조회로 판정을 받는다. 합류 전 글은 여기서 사라진다.
    const hidden = await withRls(room.latecomer, (sql) => readMessage(sql, room.before.id));
    expect(hidden).toBeNull();
  });
});

describe("시스템 메시지", () => {
  /** 그 방의 시스템 메시지만. 사람의 글은 빼고 본다. */
  async function systemMessages(ctx: RlsContext, groupId: string) {
    const all = await withRls(ctx, (sql) => listMessages(sql, groupId, { limit: 100 }));
    return all.filter((m) => m.systemKind !== null);
  }

  it("주선자가 들어오고 나간 것이 남는다", async () => {
    const party = await withOwner((sql) => makeParty(sql, `j${Date.now() % 100000}`));

    const joined = (await systemMessages(party.owner, party.groupId)).filter(
      (m) => m.systemKind === "ADMIN_JOINED",
    );
    // 개설자와 동료 둘 다 들어온 기록이 있다.
    expect(joined).toHaveLength(2);
    // 누가 들어왔는지 이름이 남는다. 픽스처의 주선자 이름은 `${TAG}-…-owner|peer` 다.
    expect(joined.every((m) => m.payload.actorName?.includes(TAG))).toBe(true);
    // 문장은 화면이 만든다 — DB 에는 본문이 없다.
    expect(joined.every((m) => m.body === "")).toBe(true);

    await withOwner((sql) =>
      sql.query(`DELETE FROM group_admins WHERE group_id = $1 AND user_id = $2`, [
        party.groupId,
        party.peerId,
      ]),
    );

    const left = (await systemMessages(party.owner, party.groupId)).filter(
      (m) => m.systemKind === "ADMIN_LEFT",
    );
    expect(left).toHaveLength(1);
    // 나간 사람은 더 이상 같은 모임이 아니라 이름을 조회할 수 없다 — 그래서 적어 둔다.
    expect(left[0]!.payload.actorName).toContain(TAG);
  });

  it("멤버 등록은 공개 번호로만 남는다", async () => {
    const party = await withOwner((sql) => makeParty(sql, `r${Date.now() % 100000}`));

    const registered = (await systemMessages(party.owner, party.groupId)).filter(
      (m) => m.systemKind === "PROFILE_REGISTERED",
    );
    expect(registered).toHaveLength(1);
    const code = registered[0]!.payload.profileCode!;
    expect(code).toBeGreaterThan(0);

    // 방에 멤버 이름이 적히지 않는다. 픽스처의 이름은 `${TAG}-…-이름` 이다.
    expect(JSON.stringify(registered[0]!.payload)).not.toContain("-이름");

    // 번호에 링크를 달 수 있도록 프로필 id 가 함께 온다. payload 에는 넣지 않는다 —
    // 저장된 사실은 번호뿐이고 id 는 읽을 때 RLS 를 통과해 붙는다.
    const profileId = await withOwner(async (sql) => {
      const r = await sql.query<{ id: string }>(
        `SELECT id FROM profiles WHERE public_code = $1`,
        [code],
      );
      return r.rows[0]!.id;
    });
    expect(registered[0]!.profileIds).toEqual({ [String(code)]: profileId });
    expect(JSON.stringify(registered[0]!.payload)).not.toContain(profileId);
  });

  it("볼 수 없는 번호에는 링크를 달지 않는다", async () => {
    const party = await withOwner((sql) => makeParty(sql, `g${Date.now() % 100000}`));
    const before = (await systemMessages(party.owner, party.groupId)).filter(
      (m) => m.systemKind === "PROFILE_REGISTERED",
    );
    const code = before[0]!.payload.profileCode!;
    expect(before[0]!.profileIds[String(code)]).toBeDefined();

    // 프로필이 사라지면 사건 기록은 남지만 갈 곳이 없다. 화면이 죽은 링크를 만들지
    // 않도록 map 에서 빠진다 — 번호는 글자로만 남는다.
    await withOwner((sql) => sql.query(`DELETE FROM profiles WHERE public_code = $1`, [code]));

    const after = (await systemMessages(party.owner, party.groupId)).filter(
      (m) => m.systemKind === "PROFILE_REGISTERED",
    );
    expect(after).toHaveLength(1);
    expect(after[0]!.payload.profileCode).toBe(code);
    expect(after[0]!.profileIds).toEqual({});
  });

  it("신청과 연결이 남는다", async () => {
    const party = await withOwner((sql) => makeParty(sql, `x${Date.now() % 100000}`));
    const pair = await withOwner(async (sql) => {
      const make = async (key: string, gender: "MALE" | "FEMALE") => {
        const u = await sql.query<{ id: string }>(
          `INSERT INTO users (role, phone, display_name) VALUES ('MEMBER', $1, $2) RETURNING id`,
          [`0109${String(Date.now()).slice(-6)}${key}`, `${TAG}-${key}`],
        );
        const p = await sql.query<{ id: string }>(
          `INSERT INTO profiles (group_id, user_id, gender, birth_year, residence_region,
                                 status, visibility, real_name, created_by)
           VALUES ($1, $2, $3, 1990, 'SEOUL', 'ACTIVE', 'LISTED', $4, $5) RETURNING id`,
          [party.groupId, u.rows[0]!.id, gender, `${TAG}-${key}-이름`, party.ownerId],
        );
        return p.rows[0]!.id;
      };
      // 신청은 이성 사이에만 성립한다(0048).
      return { a: await make("s1", "MALE"), b: await make("s2", "FEMALE") };
    });

    const requestId = await withOwner(async (sql) => {
      const r = await sql.query<{ id: string }>(
        `INSERT INTO match_requests (requester_profile_id, target_profile_id)
         VALUES ($1, $2) RETURNING id`,
        [pair.a, pair.b],
      );
      return r.rows[0]!.id;
    });

    const requested = (await systemMessages(party.owner, party.groupId)).filter(
      (m) => m.systemKind === "MATCH_REQUESTED",
    );
    expect(requested).toHaveLength(1);
    expect(requested[0]!.payload.requesterCode).toBeGreaterThan(0);
    expect(requested[0]!.payload.targetCode).toBeGreaterThan(0);

    await withOwner((sql) =>
      sql.query(`UPDATE match_requests SET status = 'INTRODUCED' WHERE id = $1`, [requestId]),
    );

    const introduced = (await systemMessages(party.owner, party.groupId)).filter(
      (m) => m.systemKind === "MATCH_INTRODUCED",
    );
    expect(introduced).toHaveLength(1);
  });

  it("사람이 시스템 메시지를 만들지 못한다", async () => {
    await expect(
      withRls(A.owner, (sql) =>
        sql.query(
          `INSERT INTO group_messages (group_id, author_user_id, body, system_kind)
           VALUES ($1, $2, '', 'ADMIN_JOINED')`,
          [A.groupId, A.ownerId],
        ),
      ),
    ).rejects.toThrow();
  });

  it("시스템 메시지는 지우지 못한다", async () => {
    const party = await withOwner((sql) => makeParty(sql, `d${Date.now() % 100000}`));
    const system = (await systemMessages(party.owner, party.groupId))[0]!;

    await expect(
      withRls(party.owner, (sql) => deleteMessage(sql, party.groupId, system.id)),
    ).rejects.toThrow();
  });

  it("시스템 메시지는 텔레그램 알림을 만들지 않는다", async () => {
    const party = await withOwner((sql) => makeParty(sql, `t${Date.now() % 100000}`));
    await withRls(party.peer, (sql) =>
      updatePrefs(sql, party.groupId, party.peerId, { telegramNotify: true }),
    );

    // 알림을 켠 뒤에 일어난 사건이다. 신청·연결은 0017 계열이 이미 알린다.
    await withOwner((sql) =>
      sql.query(
        `INSERT INTO profiles (group_id, gender, birth_year, residence_region, real_name, created_by)
         VALUES ($1, 'FEMALE', 1995, 'SEOUL', $2, $3)`,
        [party.groupId, `${TAG}-알림확인-이름`, party.ownerId],
      ),
    );

    const count = await withOwner(async (sql) => {
      const r = await sql.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM notifications
          WHERE group_id = $1 AND kind = 'GROUP_MESSAGE'`,
        [party.groupId],
      );
      return r.rows[0]!.n;
    });
    expect(count).toBe(0);
  });
});

describe("LISTEN/NOTIFY", () => {
  /** 조건이 참이 될 때까지 짧게 기다린다. NOTIFY 는 커밋 뒤에 도착한다. */
  async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > until) throw new Error("이벤트를 기다리다 시간이 지났습니다.");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  it("새 글과 지움을 알리고, payload 에 본문이 없다", async () => {
    const payloads: string[] = [];
    const listener = listen("bolsaram_group_chat", (payload) => payloads.push(payload));
    try {
      await listener.ready;

      const secret = `${TAG}-본문은 실리지 않는다`;
      const written = await withRls(A.owner, (sql) =>
        createMessage(sql, A.groupId, A.ownerId, secret),
      );

      const mine = () =>
        payloads
          .map((raw) => groupChatNotifySchema.parse(JSON.parse(raw)))
          .filter((event) => event.messageId === written.id);

      await waitFor(() => mine().length >= 1);
      const created = mine()[0]!;
      expect(created.kind).toBe("created");
      expect(created.groupId).toBe(A.groupId);
      // 이 채널은 권한 판정을 거치지 않는다 — 본문이 흐르면 그 자체로 경계를 넘는다.
      expect(payloads.join("")).not.toContain(secret);

      await withRls(A.owner, (sql) => deleteMessage(sql, A.groupId, written.id));
      await waitFor(() => mine().length >= 2);
      expect(mine()[1]!.kind).toBe("deleted");
    } finally {
      await listener.close();
    }
  });

  it("계정 삭제로 작성자만 비워지는 것은 알리지 않는다", async () => {
    const party = await withOwner((sql) => makeParty(sql, `b${Date.now() % 100000}`));
    const messageId = await seedMessage(party.groupId, party.peerId, `${TAG}-떠나는 사람`);

    const payloads: string[] = [];
    const listener = listen("bolsaram_group_chat", (payload) => payloads.push(payload));
    try {
      await listener.ready;
      await withOwner((sql) => sql.query(`DELETE FROM users WHERE id = $1`, [party.peerId]));
      // 나가는 것은 방에 남지만(ADMIN_LEFT), 남의 글에 작성자만 비우는 UPDATE 는
      // 화면에 알릴 것이 없다.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const about = payloads
        .map((raw) => groupChatNotifySchema.parse(JSON.parse(raw)))
        .filter((event) => event.messageId === messageId);
      expect(about).toHaveLength(0);
    } finally {
      await listener.close();
    }
  });
});

describe("텔레그램 알림", () => {
  async function notificationsFor(groupId: string): Promise<{ recipient: string; sent: boolean }[]> {
    return withOwner(async (sql) => {
      const r = await sql.query<{ recipient_user_id: string; sent_at: Date | null }>(
        `SELECT recipient_user_id, sent_at FROM notifications
          WHERE group_id = $1 ORDER BY created_at`,
        [groupId],
      );
      return r.rows.map((row) => ({ recipient: row.recipient_user_id, sent: row.sent_at !== null }));
    });
  }

  it("켜 둔 동료에게만 생기고 쓴 사람에게는 생기지 않는다", async () => {
    const party = await withOwner((sql) => makeParty(sql, `n${Date.now() % 100000}`));
    // 양쪽 다 켠다 — 그래도 쓴 사람은 받지 않아야 한다.
    await withRls(party.peer, (sql) =>
      updatePrefs(sql, party.groupId, party.peerId, { telegramNotify: true }),
    );
    await withRls(party.owner, (sql) =>
      updatePrefs(sql, party.groupId, party.ownerId, { telegramNotify: true }),
    );

    await withRls(party.owner, (sql) =>
      createMessage(sql, party.groupId, party.ownerId, "새 글"),
    );

    const rows = await notificationsFor(party.groupId);
    expect(rows.map((r) => r.recipient)).toEqual([party.peerId]);
  });

  it("끈 사람에게는 생기지 않는다", async () => {
    const party = await withOwner((sql) => makeParty(sql, `f${Date.now() % 100000}`));
    await withRls(party.owner, (sql) =>
      createMessage(sql, party.groupId, party.ownerId, "알림 없는 글"),
    );
    expect(await notificationsFor(party.groupId)).toHaveLength(0);
  });

  it("아직 보내지 않은 알림이 있으면 접힌다", async () => {
    const party = await withOwner((sql) => makeParty(sql, `d${Date.now() % 100000}`));
    await withRls(party.peer, (sql) =>
      updatePrefs(sql, party.groupId, party.peerId, { telegramNotify: true }),
    );

    await withRls(party.owner, (sql) => createMessage(sql, party.groupId, party.ownerId, "1"));
    await withRls(party.owner, (sql) => createMessage(sql, party.groupId, party.ownerId, "2"));
    expect(await notificationsFor(party.groupId)).toHaveLength(1);

    // 보낸 뒤에 온 글은 다시 알린다.
    await withOwner((sql) =>
      sql.query(`UPDATE notifications SET sent_at = now() WHERE group_id = $1`, [party.groupId]),
    );
    await withRls(party.owner, (sql) => createMessage(sql, party.groupId, party.ownerId, "3"));
    expect(await notificationsFor(party.groupId)).toHaveLength(2);
  });

  it("payload 에는 모임 이름만 들어간다", async () => {
    const party = await withOwner((sql) => makeParty(sql, `p${Date.now() % 100000}`));
    await withRls(party.peer, (sql) =>
      updatePrefs(sql, party.groupId, party.peerId, { telegramNotify: true }),
    );
    await withRls(party.owner, (sql) =>
      createMessage(sql, party.groupId, party.ownerId, "본문은 실리지 않는다"),
    );

    const payload = await withOwner(async (sql) => {
      const r = await sql.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM notifications WHERE group_id = $1`,
        [party.groupId],
      );
      return r.rows[0]!.payload;
    });
    expect(Object.keys(payload)).toEqual(["groupName"]);
    expect(payload.groupName).toContain(TAG);
  });

  it("알림 행을 런타임 롤이 만들지 못한다", async () => {
    await expect(
      withRls(A.owner, (sql) =>
        sql.query(
          `INSERT INTO notifications (kind, recipient_user_id, group_id)
           VALUES ('GROUP_MESSAGE', $1, $2)`,
          [A.peerId, A.groupId],
        ),
      ),
    ).rejects.toThrow();
  });
});
