/**
 * 모임 채팅방 통합 테스트 (마이그레이션 0040).
 *
 * 방의 경계는 모임이고 참여자 명단은 `group_admins` 다. 여기서 지키는 성질 —
 * 대부분 "안 되는 것"이다.
 *   * 같은 모임 주선자끼리만 읽고 쓴다. 다른 모임도 회원도 들어오지 못한다.
 *   * 남의 이름으로 쓸 수 없다.
 *   * 쓴 글은 고칠 수 없다. 지우기만 되고, 그것도 자기 것만이다.
 *   * 지운 글의 본문은 DB 에도 남지 않는다.
 *   * 알림은 켜 둔 사람에게만 가고, 쓴 사람에게는 가지 않는다.
 *   * 아직 보내지 않은 알림이 있으면 새 글이 와도 하나로 접힌다.
 *   * 계정이 지워져도 대화는 남는다(0041).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withOwner, withRls, type RlsContext, type Sql } from "@bolsaram/db";
import {
  createMessage,
  deleteMessage,
  listMessages,
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
      `INSERT INTO users (role, email, password_hash, display_name)
       VALUES ('ADMIN', $1, 'x', $2) RETURNING id`,
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

  it("회원은 방을 읽지 못한다", async () => {
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

  it("내가 쓴 것과 읽은 것은 세지 않는다", async () => {
    const party = await withOwner((sql) => makeParty(sql, `u${Date.now() % 100000}`));

    await seedMessage(party.groupId, party.ownerId, `${TAG}-1`);
    await seedMessage(party.groupId, party.ownerId, `${TAG}-2`);

    const before = await withRls(party.peer, (sql) => unreadByGroup(sql, party.peerId));
    expect(before.find((g) => g.groupId === party.groupId)?.unread).toBe(2);

    // 쓴 사람에게는 처음부터 안 읽은 것이 없다.
    const author = await withRls(party.owner, (sql) => unreadByGroup(sql, party.ownerId));
    expect(author.find((g) => g.groupId === party.groupId)?.unread).toBe(0);

    await withRls(party.peer, (sql) =>
      updatePrefs(sql, party.groupId, party.peerId, { readUpTo: new Date().toISOString() }),
    );
    const after = await withRls(party.peer, (sql) => unreadByGroup(sql, party.peerId));
    expect(after.find((g) => g.groupId === party.groupId)?.unread).toBe(0);
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
