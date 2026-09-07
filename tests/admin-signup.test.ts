/**
 * 주선자 가입 통합 테스트.
 *
 * 가입이 **열려 있다**는 것이 이 서비스의 전제다. 따라서 여기서 지켜야 하는 성질은
 * "가입이 되는가"보다 **"가입만으로는 아무것도 볼 수 없는가"** 다.
 * 이게 깨지면 누구나 가입해서 남의 모임 회원 정보를 보게 된다.
 */
import { afterAll, describe, expect, it } from "vitest";
import { closePools, withOwner, withRls } from "@bolsaram/db";
import { loginAdmin } from "../apps/web/src/server/auth/login";
import { createGroupForAdmin, signupAdmin } from "../apps/web/src/server/auth/signup";

const TAG = `signuptest-${Date.now()}`;
const PASSWORD = "signup-password-1234";

let seq = 0;
function nextEmail(): string {
  seq += 1;
  return `${TAG}-${seq}@test.local`;
}

afterAll(async () => {
  await withOwner(async (sql) => {
    // 모임보다 프로필·주선자 연결을 먼저 지운다(FK).
    await sql.query(`DELETE FROM profiles WHERE real_name LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM users WHERE display_name LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM groups WHERE name LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM admin_login_failures WHERE email LIKE $1`, [`${TAG}%`]);
  });
  await closePools();
});

describe("가입", () => {
  it("계정과 모임을 함께 만든다", async () => {
    const email = nextEmail();
    const created = await signupAdmin({
      email,
      password: PASSWORD,
      displayName: `${TAG}-주선자`,
      groupName: `${TAG}-모임`,
    });
    expect(created.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.groupId).toMatch(/^[0-9a-f-]{36}$/);

    // 만든 사람이 OWNER 여야 한다 — 동료 초대 권한 판정의 근거다.
    const owner = await withOwner(async (sql) => {
      const r = await sql.query<{ is_owner: boolean }>(
        `SELECT is_owner FROM group_admins WHERE group_id = $1 AND user_id = $2`,
        [created.groupId, created.userId],
      );
      return r.rows[0]?.is_owner;
    });
    expect(owner).toBe(true);
  });

  it("가입한 비밀번호로 바로 로그인된다", async () => {
    const email = nextEmail();
    const created = await signupAdmin({
      email,
      password: PASSWORD,
      displayName: `${TAG}-주선자2`,
      groupName: `${TAG}-모임2`,
    });
    await expect(loginAdmin(email, PASSWORD)).resolves.toBe(created.userId);
  });

  it("같은 이메일로 두 번 가입할 수 없다", async () => {
    const email = nextEmail();
    const base = {
      password: PASSWORD,
      displayName: `${TAG}-중복`,
      groupName: `${TAG}-중복모임`,
    };
    await signupAdmin({ email, ...base });
    await expect(signupAdmin({ email, ...base })).rejects.toThrow(/이미 등록된 이메일/);
  });

  it("이메일이 겹치면 모임도 만들어지지 않는다", async () => {
    // 계정 실패가 트랜잭션 전체를 되돌려야 한다 — 주인 없는 모임이 남으면 안 된다.
    const email = nextEmail();
    await signupAdmin({
      email,
      password: PASSWORD,
      displayName: `${TAG}-원본`,
      groupName: `${TAG}-원본모임`,
    });
    const orphanName = `${TAG}-고아모임`;
    await expect(
      signupAdmin({
        email,
        password: PASSWORD,
        displayName: `${TAG}-재시도`,
        groupName: orphanName,
      }),
    ).rejects.toThrow();

    const left = await withOwner(async (sql) => {
      const r = await sql.query(`SELECT 1 FROM groups WHERE name = $1`, [orphanName]);
      return r.rowCount ?? 0;
    });
    expect(left).toBe(0);
  });
});

describe("가입만으로는 아무것도 볼 수 없다", () => {
  it("새 주선자에게 남의 모임 회원이 보이지 않는다", async () => {
    // 먼저 다른 모임에 회원 하나를 둔다.
    const other = await signupAdmin({
      email: nextEmail(),
      password: PASSWORD,
      displayName: `${TAG}-남`,
      groupName: `${TAG}-남의모임`,
    });
    await withOwner((sql) =>
      sql.query(
        `INSERT INTO profiles (group_id, gender, birth_year, residence_region,
                               status, visibility, real_name, created_by)
         VALUES ($1,'FEMALE',1993,'SEOUL','ACTIVE','LISTED',$2,$3)`,
        [other.groupId, `${TAG}-남의회원`, other.userId],
      ),
    );

    // 방금 가입한 주선자가 본다.
    const fresh = await signupAdmin({
      email: nextEmail(),
      password: PASSWORD,
      displayName: `${TAG}-신규`,
      groupName: `${TAG}-신규모임`,
    });
    const visible = await withRls({ userId: fresh.userId, role: "ADMIN" }, async (sql) => {
      const r = await sql.query(`SELECT id FROM profiles`);
      return r.rowCount ?? 0;
    });
    // 자기 모임은 비어 있고 남의 모임은 안 보인다.
    expect(visible).toBe(0);
  });
});

describe("모임 만들기 (모임에서 제거된 주선자)", () => {
  it("모임이 없으면 만들 수 있다", async () => {
    const userId = await withOwner(async (sql) => {
      const r = await sql.query<{ id: string }>(
        `INSERT INTO users (role, email, password_hash, display_name)
         VALUES ('ADMIN', $1, 'x', $2) RETURNING id`,
        [nextEmail(), `${TAG}-무소속`],
      );
      return r.rows[0]!.id;
    });
    const created = await createGroupForAdmin({ userId, name: `${TAG}-복귀모임` });
    expect(created.groupId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("이미 모임이 있으면 만들 수 없다", async () => {
    const existing = await signupAdmin({
      email: nextEmail(),
      password: PASSWORD,
      displayName: `${TAG}-기존`,
      groupName: `${TAG}-기존모임`,
    });
    await expect(
      createGroupForAdmin({ userId: existing.userId, name: `${TAG}-둘째모임` }),
    ).rejects.toThrow(/이미 모임에 속해/);
  });
});
