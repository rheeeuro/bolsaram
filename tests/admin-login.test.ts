/**
 * 관리자 로그인 시도 제한 통합 테스트.
 *
 * 회원 OTP 에는 시도 제한이 있었지만 관리자 비밀번호에는 없었다 — 공개 도메인에서
 * 무한히 시도할 수 있었다(실측 2026-09-07: 10회 연속 403, 차단 없음).
 *
 * 여기서 지키는 성질:
 *   * 창 안에서 정해진 횟수를 넘기면 비밀번호가 맞아도 거절한다.
 *   * 창이 지나면 자연히 풀린다 — 영구 락아웃이 없다(주선자가 여러 명이어도
 *     특정 계정을 무기한 잠글 수 없어야 한다).
 *   * 성공하면 실패 기록이 비워진다.
 *   * 런타임 롤은 실패 기록 테이블에 접근할 수 없다.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closePools, withOwner, withRls } from "@bolsaram/db";
import { loginAdmin } from "../apps/web/src/server/auth/login";
import { hashPassword } from "../apps/web/src/server/crypto";

const TAG = `adminlogin-${Date.now()}`;
const EMAIL = `${TAG}@test.local`;
/** 존재하지 않는 계정도 실패가 누적된다 — 실행마다 새 주소를 써서 서로 간섭하지 않게 한다. */
const MISSING_EMAIL = `${TAG}-missing@test.local`;
const PASSWORD = "correct-horse-battery";

beforeAll(async () => {
  await withOwner((sql) =>
    sql.query(
      `INSERT INTO users (role, email, password_hash, display_name)
       VALUES ('ADMIN', $1, $2, $3)`,
      [EMAIL, hashPassword(PASSWORD), TAG],
    ),
  );
});

beforeEach(async () => {
  // 존재하지 않는 계정으로 온 시도도 누적되므로 이 실행이 만든 기록을 전부 지운다.
  await withOwner((sql) =>
    sql.query(`DELETE FROM admin_login_failures WHERE email LIKE $1`, [`${TAG}%`]),
  );
});

afterAll(async () => {
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM admin_login_failures WHERE email LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM users WHERE display_name = $1`, [TAG]);
  });
  await closePools();
});

/** 실패 기록을 원하는 시각으로 밀어 넣는다(창 경계 검증용). */
async function seedFailures(count: number, agoMinutes = 0): Promise<void> {
  await withOwner((sql) =>
    sql.query(
      `INSERT INTO admin_login_failures (email, failed_at)
       SELECT $1, now() - make_interval(mins => $3) FROM generate_series(1, $2)`,
      [EMAIL, count, agoMinutes],
    ),
  );
}

describe("관리자 로그인", () => {
  it("맞는 비밀번호로 통과한다", async () => {
    await expect(loginAdmin(EMAIL, PASSWORD)).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });

  it("틀린 비밀번호는 계정 존재를 드러내지 않는다", async () => {
    await expect(loginAdmin(EMAIL, "wrong-password")).rejects.toThrow(
      /이메일 또는 비밀번호가 올바르지 않습니다/,
    );
    await expect(loginAdmin(MISSING_EMAIL, "wrong-password")).rejects.toThrow(
      /이메일 또는 비밀번호가 올바르지 않습니다/,
    );
  });

  it("실패가 쌓이면 맞는 비밀번호도 거절한다", async () => {
    for (let i = 0; i < 5; i += 1) {
      await expect(loginAdmin(EMAIL, `wrong-${i}`)).rejects.toThrow(/올바르지 않습니다/);
    }
    // 여기서 막히지 않으면 무한 시도가 가능하다.
    await expect(loginAdmin(EMAIL, PASSWORD)).rejects.toThrow(/시도가 너무 많습니다/);
  });

  it("제한 직전까지는 통과한다", async () => {
    await seedFailures(4);
    await expect(loginAdmin(EMAIL, PASSWORD)).resolves.toBeTruthy();
  });

  it("창이 지난 실패는 세지 않는다", async () => {
    // 영구 락아웃이 없어야 한다 — 16분 전 실패 10건은 무시된다.
    await seedFailures(10, 16);
    await expect(loginAdmin(EMAIL, PASSWORD)).resolves.toBeTruthy();
  });

  it("성공하면 실패 기록을 비운다", async () => {
    await seedFailures(4);
    await loginAdmin(EMAIL, PASSWORD);
    const left = await withOwner(async (sql) => {
      const r = await sql.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM admin_login_failures WHERE email = $1`,
        [EMAIL],
      );
      return r.rows[0]!.count;
    });
    expect(left).toBe(0);
  });

  it("런타임 롤은 실패 기록에 접근할 수 없다", async () => {
    await expect(
      withRls({ userId: null, role: "ADMIN" }, (sql) =>
        sql.query(`SELECT 1 FROM admin_login_failures`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
