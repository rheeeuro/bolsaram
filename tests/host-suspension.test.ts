/**
 * 주선자 정지 · 모임 만들기 요청 알림 통합 테스트 (0067).
 *
 * 정지가 지켜야 하는 성질은 **정지된 주선자가 어떤 경로로도 들어오지 못한다**는 것이다 —
 * 이미 열린 세션, 새 로그인, 텔레그램 봇, 알림 발송. 그리고 정지는 주선자에게만 걸리고
 * 관리자·멤버에게는 걸리지 않는다.
 *
 * 세션은 `next/headers` 의 쿠키를 쓴다. 여기서는 쿠키 저장소를 메모리로 바꿔
 * 실제 `createSession` · `readSession` 을 그대로 부른다.
 *
 * 관리자 지정과 모임 만들기 승인은 전역 한 줄이라 시작 값을 기억했다가 되돌린다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// 경로는 세션 모듈이 실제로 해석하는 웹 앱의 `next` 다(r2-storage 테스트와 같은 방식).
const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("../apps/web/node_modules/next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

import { closePools, withOwner } from "@bolsaram/db";
import { loginWithOAuth } from "../apps/web/src/server/auth/oauth";
import {
  listHosts,
  readOperatorSettings,
  suspendHost,
  unsuspendHost,
  updateOperatorSettings,
} from "../apps/web/src/server/auth/operator";
import {
  AccountSuspendedError,
  createSession,
  readSession,
} from "../apps/web/src/server/auth/session";
import { findTelegramIdentity } from "../apps/web/src/server/auth/telegram";
import {
  consumeGroupInvite,
  createGroupForAdmin,
  issueGroupInvite,
  requestGroupCreation,
} from "../apps/web/src/server/auth/group-invite";
import { claimPending } from "../apps/web/src/server/notify/outbox";
import { runTag } from "./tags";

const TAG = runTag("sus");
const TG_BASE = 9_400_000_000 + Math.floor(Math.random() * 1_000_000);

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

async function seedProfile(createdBy: string, groupId: string | null): Promise<string> {
  return withOwner(async (sql) => {
    const r = await sql.query<{ id: string }>(
      `INSERT INTO profiles (group_id, gender, birth_year, residence_region,
                             status, real_name, created_by)
       VALUES ($1, 'FEMALE', 1993, 'SEOUL', 'ACTIVE', $2, $3) RETURNING id`,
      [groupId, `${TAG}-프로필`, createdBy],
    );
    return r.rows[0]!.id;
  });
}

async function profileStatus(id: string): Promise<string | undefined> {
  return withOwner(async (sql) => {
    const r = await sql.query<{ status: string }>(`SELECT status FROM profiles WHERE id = $1`, [
      id,
    ]);
    return r.rows[0]?.status;
  });
}

async function setOperator(userId: string | null): Promise<void> {
  await withOwner((sql) =>
    sql.query(`UPDATE operator_settings SET operator_user_id = $1`, [userId]),
  );
}

/** 이 사용자로 로그인한 브라우저 하나. 쿠키 저장소를 비우고 새 세션을 받는다. */
async function signIn(userId: string): Promise<void> {
  jar.clear();
  await createSession(userId, "vitest");
}

let initialOperator: string | null = null;
let initialApproval = false;
let operatorId = "";

beforeAll(async () => {
  initialOperator = await withOwner(async (sql) => {
    const r = await sql.query<{ operator_user_id: string | null }>(
      `SELECT operator_user_id FROM operator_settings`,
    );
    return r.rows[0]?.operator_user_id ?? null;
  });
  initialApproval = (await readOperatorSettings()).groupCreationRequiresApproval;
  operatorId = await newAdmin("관리자");
  await setOperator(operatorId);
});

afterAll(async () => {
  await updateOperatorSettings({ operatorId, groupCreationRequiresApproval: initialApproval });
  await setOperator(initialOperator);
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM profiles WHERE real_name LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM groups WHERE name LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM users WHERE display_name LIKE $1`, [`${TAG}%`]);
  });
  await closePools();
});

describe("정지하면", () => {
  let host = "";
  let groupId = "";
  let publicProfile = "";
  let groupProfile = "";
  const tgUser = TG_BASE + 1;

  beforeAll(async () => {
    host = await newAdmin("정지대상");
    ({ groupId } = await createGroupForAdmin({ userId: host, name: `${TAG}-G` }));
    publicProfile = await seedProfile(host, null);
    groupProfile = await seedProfile(host, groupId);
    await withOwner((sql) =>
      sql.query(
        `INSERT INTO telegram_connections (user_id, telegram_user_id, telegram_chat_id)
         VALUES ($1, $2, $2)`,
        [host, tgUser],
      ),
    );
  });

  it("열려 있던 세션이 바로 끊긴다", async () => {
    await signIn(host);
    expect(await readSession()).toMatchObject({ userId: host });

    const result = await suspendHost({ operatorId, userId: host, reason: "  테스트  " });
    expect(result.deactivatedProfiles).toBe(2);
    expect(await readSession()).toBeNull();
  });

  it("세션 폐기를 건너뛰어도 남은 세션으로 들어오지 못한다", async () => {
    // 정지 행만 남기고 세션을 되살려 본다 — 읽기 쪽이 따로 막아야 한다.
    await withOwner((sql) =>
      sql.query(`UPDATE sessions SET revoked_at = NULL WHERE user_id = $1`, [host]),
    );
    expect(await readSession()).toBeNull();
  });

  it("새로 로그인할 수 없다", async () => {
    jar.clear();
    await expect(createSession(host)).rejects.toBeInstanceOf(AccountSuspendedError);
    expect(jar.size).toBe(0);
  });

  it("텔레그램 봇이 신원을 주지 않는다", async () => {
    expect(await findTelegramIdentity(tgUser)).toBeNull();
  });

  it("등록한 프로필이 모두 비활성이 된다 — 모임과 전체공개 모두", async () => {
    expect(await profileStatus(publicProfile)).toBe("INACTIVE");
    expect(await profileStatus(groupProfile)).toBe("INACTIVE");
  });

  it("모임 소속은 남는다", async () => {
    const r = await withOwner((sql) =>
      sql.query(`SELECT 1 FROM group_admins WHERE user_id = $1`, [host]),
    );
    expect(r.rowCount).toBe(1);
  });

  it("목록에 정지로 나오고 사유가 붙는다", async () => {
    const row = (await listHosts()).find((h) => h.userId === host);
    expect(row?.suspension).toMatchObject({ reason: "테스트" });
  });

  it("점검 계정(`pnpm dev:session`)은 목록에 나오지 않는다", async () => {
    await withOwner((sql) =>
      sql.query(
        `INSERT INTO users (role, email, display_name)
         VALUES ('ADMIN', 'dev-check@bolsaram.local', '점검') ON CONFLICT DO NOTHING`,
      ),
    );
    const emails = (await listHosts()).map((h) => h.email);
    expect(emails).not.toContain("dev-check@bolsaram.local");
    expect(emails).toContain(`${TAG}-1@test.local`);
  });

  it("두 번 정지할 수 없다", async () => {
    await expect(suspendHost({ operatorId, userId: host })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("풀면 다시 들어오지만 프로필은 비활성 그대로다", async () => {
    await unsuspendHost({ operatorId, userId: host });
    await signIn(host);
    expect(await readSession()).toMatchObject({ userId: host });
    expect(await findTelegramIdentity(tgUser)).toMatchObject({ userId: host });
    expect(await profileStatus(publicProfile)).toBe("INACTIVE");
    await expect(unsuspendHost({ operatorId, userId: host })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("정지가 끊는 흔적", () => {
  it("그 사람이 발급한 모임 초대 코드를 거둔다", async () => {
    const host = await newAdmin("코드");
    const { groupId } = await createGroupForAdmin({ userId: host, name: `${TAG}-C` });
    const issued = await issueGroupInvite({ groupId, createdBy: host });
    await suspendHost({ operatorId, userId: host });
    await expect(
      consumeGroupInvite({ code: issued.code, userId: await newAdmin("합류") }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("기다리던 모임 만들기 요청을 거절로 닫는다", async () => {
    await updateOperatorSettings({ operatorId, groupCreationRequiresApproval: true });
    const host = await newAdmin("요청");
    const requested = await requestGroupCreation({
      userId: host,
      isOperator: false,
      name: `${TAG}-R`,
    });
    expect(requested.status).toBe("PENDING");
    await suspendHost({ operatorId, userId: host });
    const r = await withOwner((sql) =>
      sql.query<{ status: string }>(
        `SELECT status FROM group_creation_requests WHERE requested_by = $1`,
        [host],
      ),
    );
    expect(r.rows.map((row) => row.status)).toEqual(["REJECTED"]);
  });

  it("정지된 주선자에게 알림을 보내지 않는다", async () => {
    const host = await newAdmin("알림");
    await withOwner(async (sql) => {
      await sql.query(
        `INSERT INTO telegram_connections (user_id, telegram_user_id, telegram_chat_id)
         VALUES ($1, $2, $2)`,
        [host, TG_BASE + 2],
      );
      await sql.query(
        `INSERT INTO notifications (kind, recipient_user_id, payload)
         VALUES ('GROUP_MESSAGE', $1, '{}')`,
        [host],
      );
    });
    await suspendHost({ operatorId, userId: host });
    const claimed = await claimPending();
    const mine = await withOwner((sql) =>
      sql.query<{ id: string; attempts: number }>(
        `SELECT id, attempts FROM notifications WHERE recipient_user_id = $1`,
        [host],
      ),
    );
    expect(claimed.map((c) => c.id)).not.toContain(mine.rows[0]!.id);
    expect(mine.rows[0]!.attempts).toBe(0);
  });
});

describe("정지할 수 없는 계정", () => {
  it("관리자 본인", async () => {
    await expect(suspendHost({ operatorId, userId: operatorId })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("관리자 — 다른 계정 명의로 불러도, DB 에 직접 넣어도", async () => {
    const other = await newAdmin("다른");
    await expect(suspendHost({ operatorId: other, userId: operatorId })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      withOwner((sql) =>
        sql.query(`INSERT INTO user_suspensions (user_id) VALUES ($1)`, [operatorId]),
      ),
    ).rejects.toThrow(/관리자는 정지할 수 없습니다/);
  });

  it("멤버 계정", async () => {
    const member = await withOwner(async (sql) => {
      const r = await sql.query<{ id: string }>(
        `INSERT INTO users (role, display_name) VALUES ('MEMBER', $1) RETURNING id`,
        [`${TAG}-멤버`],
      );
      return r.rows[0]!.id;
    });
    await expect(suspendHost({ operatorId, userId: member })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      withOwner((sql) =>
        sql.query(`INSERT INTO user_suspensions (user_id) VALUES ($1)`, [member]),
      ),
    ).rejects.toThrow(/주선자 계정만/);
  });

  it("관리자로 지정되면 정지가 풀린다", async () => {
    const host = await newAdmin("새관리자");
    await suspendHost({ operatorId, userId: host });
    const { syncOperatorAccount } = await import("../apps/web/src/server/auth/operator");
    const email = await withOwner(async (sql) => {
      const r = await sql.query<{ email: string }>(`SELECT email::text FROM users WHERE id = $1`, [
        host,
      ]);
      return r.rows[0]!.email;
    });
    try {
      expect(await syncOperatorAccount(email)).toBe(host);
      const r = await withOwner((sql) =>
        sql.query(`SELECT 1 FROM user_suspensions WHERE user_id = $1`, [host]),
      );
      expect(r.rowCount).toBe(0);
    } finally {
      await setOperator(operatorId);
    }
  });
});

describe("모임 만들기 요청 알림", () => {
  it("승인이 켜져 있을 때 요청이 들어오면 관리자에게 알림을 남긴다", async () => {
    await updateOperatorSettings({ operatorId, groupCreationRequiresApproval: true });
    const host = await newAdmin("알림요청");
    await requestGroupCreation({ userId: host, isOperator: false, name: `${TAG}-N` });
    const r = await withOwner((sql) =>
      sql.query<{ kind: string; group_name: string }>(
        `SELECT kind::text, payload->>'groupName' AS group_name FROM notifications
          WHERE recipient_user_id = $1 AND payload->>'groupName' = $2`,
        [operatorId, `${TAG}-N`],
      ),
    );
    expect(r.rows).toEqual([{ kind: "GROUP_CREATION_REQUESTED", group_name: `${TAG}-N` }]);
  });

  it("관리자가 없으면 알림을 만들지 않는다", async () => {
    await setOperator(null);
    try {
      const host = await newAdmin("관리자없음");
      await requestGroupCreation({ userId: host, isOperator: false, name: `${TAG}-X` });
      const r = await withOwner((sql) =>
        sql.query(`SELECT 1 FROM notifications WHERE payload->>'groupName' = $1`, [`${TAG}-X`]),
      );
      expect(r.rowCount).toBe(0);
    } finally {
      await setOperator(operatorId);
    }
  });

  it("런타임 롤은 정지 목록을 읽지 못한다", async () => {
    const { withRls } = await import("@bolsaram/db");
    await expect(
      withRls({ userId: operatorId, role: "ADMIN" }, (sql) =>
        sql.query(`SELECT 1 FROM user_suspensions`),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
