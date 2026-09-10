/**
 * 알림 아웃박스 통합 테스트 (마이그레이션 0017).
 *
 * 여기서 지키는 성질:
 *   * 신청이 생기면 **회원의 RLS 컨텍스트에서** 담당 주선자에게 알림 행이 생긴다.
 *     회원은 그 행을 만들 권한이 없고, 트리거가 대신 만든다.
 *   * 수락(=연결)도 알림을 만든다 — 실제 소개는 사람이 하므로 주선자가 알아야 한다.
 *   * 거절·취소는 알림을 만들지 않는다.
 *   * 같은 사건으로 두 번 보내지 않는다.
 *   * 알림은 담당 주선자에게만 간다(남의 모임 주선자에게 새지 않는다).
 *   * 런타임 롤은 자기 알림만 읽고, 쓰지는 못한다.
 *   * payload 에 이름·연락처가 없다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withOwner, withRls, type RlsContext, type Sql } from "@bolsaram/db";

const TAG = `notiftest-${Date.now()}`;

type Party = {
  groupId: string;
  adminId: string;
  admin: RlsContext;
  member: RlsContext;
  requesterProfileId: string;
  targetProfileId: string;
};

let A: Party;
let B: Party;

async function makeParty(sql: Sql, key: string): Promise<Party> {
  const g = await sql.query<{ id: string }>(`INSERT INTO groups (name) VALUES ($1) RETURNING id`, [
    `${TAG}-${key}`,
  ]);
  const groupId = g.rows[0]!.id;

  const a = await sql.query<{ id: string }>(
    `INSERT INTO users (role, email, password_hash, display_name)
     VALUES ('ADMIN', $1, 'x', $2) RETURNING id`,
    [`${TAG}-${key}-admin@test.local`, `${TAG}-${key}-admin`],
  );
  const adminId = a.rows[0]!.id;
  await sql.query(`INSERT INTO group_admins (group_id, user_id, is_owner) VALUES ($1, $2, true)`, [
    groupId,
    adminId,
  ]);

  const m = await sql.query<{ id: string }>(
    `INSERT INTO users (role, display_name) VALUES ('MEMBER', $1) RETURNING id`,
    [`${TAG}-${key}-member`],
  );
  const memberId = m.rows[0]!.id;

  const requester = await sql.query<{ id: string }>(
    `INSERT INTO profiles (group_id, user_id, gender, birth_year, residence_region,
                           status, visibility, real_name, created_by)
     VALUES ($1, $2, 'MALE', 1992, 'SEOUL', 'ACTIVE', 'LISTED', $3, $4) RETURNING id`,
    [groupId, memberId, `${TAG}-${key}-신청자`, adminId],
  );
  const target = await sql.query<{ id: string }>(
    `INSERT INTO profiles (group_id, gender, birth_year, residence_region,
                           status, visibility, real_name, created_by)
     VALUES ($1, 'FEMALE', 1994, 'SEOUL', 'ACTIVE', 'LISTED', $2, $3) RETURNING id`,
    [groupId, `${TAG}-${key}-대상`, adminId],
  );

  return {
    groupId,
    adminId,
    admin: { userId: adminId, role: "ADMIN" },
    member: { userId: memberId, role: "MEMBER" },
    requesterProfileId: requester.rows[0]!.id,
    targetProfileId: target.rows[0]!.id,
  };
}

/**
 * 회원 명의로 신청을 만든다 — 실제 요청 경로와 같은 컨텍스트다.
 * 같은 쌍에 활성 신청이 하나만 있을 수 있으므로(부분 유니크 인덱스) 앞 케이스가
 * 남긴 것을 먼저 치운다. 알림 행은 CASCADE 로 함께 사라진다.
 */
async function requestAs(party: Party): Promise<string> {
  await withOwner((sql) =>
    sql.query(`DELETE FROM match_requests WHERE requester_profile_id = $1`, [
      party.requesterProfileId,
    ]),
  );
  return withRls(party.member, async (sql) => {
    const r = await sql.query<{ id: string }>(
      `INSERT INTO match_requests (requester_profile_id, target_profile_id)
       VALUES ($1, $2) RETURNING id`,
      [party.requesterProfileId, party.targetProfileId],
    );
    return r.rows[0]!.id;
  });
}

type NotifRow = { kind: string; recipient_user_id: string; payload: Record<string, unknown> };

async function notifications(requestId: string): Promise<NotifRow[]> {
  return withOwner(async (sql) => {
    const r = await sql.query<NotifRow>(
      `SELECT kind, recipient_user_id, payload FROM notifications
        WHERE match_request_id = $1 ORDER BY created_at, kind`,
      [requestId],
    );
    return r.rows;
  });
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
    // notifications 는 match_requests/users 를 따라 CASCADE 로 사라진다.
    await sql.query(
      `DELETE FROM match_requests WHERE requester_profile_id IN
         (SELECT id FROM profiles WHERE real_name LIKE $1)`,
      [`${TAG}%`],
    );
    await sql.query(`DELETE FROM profiles WHERE real_name LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM users WHERE display_name LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM groups WHERE name LIKE $1`, [`${TAG}%`]);
  });
  await closePools();
});

describe("신청이 알림을 만든다", () => {
  it("회원이 신청하면 담당 주선자에게 알림이 생긴다", async () => {
    const id = await requestAs(A);
    const rows = await notifications(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("MATCH_REQUESTED");
    expect(rows[0]!.recipient_user_id).toBe(A.adminId);
  });

  it("payload 에는 공개 번호만 있다", async () => {
    const id = await requestAs(A);
    const payload = (await notifications(id))[0]!.payload;
    expect(Object.keys(payload).sort()).toEqual(["requesterCode", "targetCode"]);
    expect(typeof payload.requesterCode).toBe("number");
    // 이름이 새지 않는지 문자열 전체로 확인한다.
    expect(JSON.stringify(payload)).not.toContain(TAG);
  });

  it("남의 모임 주선자에게는 가지 않는다", async () => {
    const id = await requestAs(A);
    const recipients = (await notifications(id)).map((r) => r.recipient_user_id);
    expect(recipients).not.toContain(B.adminId);
  });

  it("수락해 연결되면 알림이 하나 더 생긴다", async () => {
    const id = await requestAs(A);
    await withRls(A.member, (sql) =>
      sql.query(`UPDATE match_requests SET status = 'INTRODUCED' WHERE id = $1 AND status = 'REQUESTED'`, [id]),
    );
    const kinds = (await notifications(id)).map((r) => r.kind);
    expect(kinds).toContain("MATCH_ACCEPTED");
    expect(kinds).toHaveLength(2);
  });

  it("같은 사건으로 두 번 만들지 않는다", async () => {
    const id = await requestAs(A);
    // 트리거가 두 번 돌아도 유니크 인덱스가 접는다.
    await withOwner(async (sql) => {
      await sql.query(`UPDATE match_requests SET status = 'INTRODUCED' WHERE id = $1`, [id]);
      await sql.query(`UPDATE match_requests SET status = 'REQUESTED' WHERE id = $1`, [id]);
      await sql.query(`UPDATE match_requests SET status = 'INTRODUCED' WHERE id = $1`, [id]);
    });
    const accepted = (await notifications(id)).filter((r) => r.kind === "MATCH_ACCEPTED");
    expect(accepted).toHaveLength(1);
  });

  // 거절당한 회원 화면에는 알림이 뜨지 않고 상대는 목록에서 조용히 사라진다.
  // 사정을 말해줄 사람이 필요하므로 신청한 쪽 담당자에게 알린다(0032).
  it("거절하면 신청한 쪽 담당 주선자에게 알린다", async () => {
    const id = await requestAs(A);
    await withRls(A.member, (sql) =>
      sql.query(`UPDATE match_requests SET status = 'REJECTED' WHERE id = $1`, [id]),
    );
    const rows = await notifications(id);
    expect(rows.map((r) => r.kind).sort()).toEqual(["MATCH_REJECTED", "MATCH_REQUESTED"]);

    const rejected = rows.filter((r) => r.kind === "MATCH_REJECTED");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.recipient_user_id).toBe(A.adminId);
  });

  it("거절을 처리한 주선자에게는 알리지 않는다", async () => {
    const id = await requestAs(A);
    // 주선자가 회원을 대신해 거절을 기록한 경우. 자기가 방금 한 일이다.
    await withRls(A.admin, (sql) =>
      sql.query(`UPDATE match_requests SET status = 'REJECTED' WHERE id = $1`, [id]),
    );
    const rejected = (await notifications(id)).filter((r) => r.kind === "MATCH_REJECTED");
    expect(rejected).toHaveLength(0);
  });

  // 취소는 거절의 대칭이다 — 답을 기다리던 쪽 담당자가 알아야 한다(0033).
  it("취소하면 받는 쪽 담당 주선자에게 알린다", async () => {
    const id = await requestAs(A);
    await withRls(A.member, (sql) =>
      sql.query(`UPDATE match_requests SET status = 'CANCELED' WHERE id = $1`, [id]),
    );
    const canceled = (await notifications(id)).filter((r) => r.kind === "MATCH_CANCELED");
    expect(canceled).toHaveLength(1);
    expect(canceled[0]!.recipient_user_id).toBe(A.adminId);
  });

  it("거절 payload 에도 공개 번호만 있다", async () => {
    const id = await requestAs(A);
    await withRls(A.member, (sql) =>
      sql.query(`UPDATE match_requests SET status = 'REJECTED' WHERE id = $1`, [id]),
    );
    const rejected = (await notifications(id)).find((r) => r.kind === "MATCH_REJECTED")!;
    expect(Object.keys(rejected.payload).sort()).toEqual(["requesterCode", "targetCode"]);
    // 거절 사유도 이름도 싣지 않는다.
    expect(JSON.stringify(rejected.payload)).not.toContain(TAG);
  });
});

describe("알림은 받는 사람만 읽는다", () => {
  it("주선자는 자기 알림을 읽는다", async () => {
    const id = await requestAs(A);
    const count = await withRls(A.admin, async (sql) => {
      const r = await sql.query(`SELECT id FROM notifications WHERE match_request_id = $1`, [id]);
      return r.rowCount ?? 0;
    });
    expect(count).toBe(1);
  });

  it("남의 알림은 읽지 못한다", async () => {
    const id = await requestAs(A);
    const count = await withRls(B.admin, async (sql) => {
      const r = await sql.query(`SELECT id FROM notifications WHERE match_request_id = $1`, [id]);
      return r.rowCount ?? 0;
    });
    expect(count).toBe(0);
  });

  it("회원은 알림을 읽지 못한다", async () => {
    const id = await requestAs(A);
    const count = await withRls(A.member, async (sql) => {
      const r = await sql.query(`SELECT id FROM notifications WHERE match_request_id = $1`, [id]);
      return r.rowCount ?? 0;
    });
    expect(count).toBe(0);
  });

  it("런타임 롤은 알림을 직접 만들지 못한다", async () => {
    // 알림을 임의로 만들 수 있으면 「보낸 것처럼」 꾸미거나 남의 봇으로 보낼 수 있다.
    await expect(
      withRls(A.admin, (sql) =>
        sql.query(`INSERT INTO notifications (kind, recipient_user_id) VALUES ('MATCH_REQUESTED', $1)`, [
          A.adminId,
        ]),
      ),
    ).rejects.toThrow();
  });

  it("런타임 롤은 알림을 보낸 것으로 표시하지 못한다", async () => {
    const id = await requestAs(A);
    await expect(
      withRls(A.admin, (sql) =>
        sql.query(`UPDATE notifications SET sent_at = now() WHERE match_request_id = $1`, [id]),
      ),
    ).rejects.toThrow();
  });
});
