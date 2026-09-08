/**
 * RLS 통합 테스트 (설계문서 §12, 부트스트랩 §12 「auth」).
 * 실제 Postgres 에 붙어 정책이 강제되는지 확인한다. `pnpm db:up` 이 필요하다.
 *
 * 앱 롤(bolsaram_app)은 NOBYPASSRLS 이므로, 여기서 통과하는 것만이 런타임에 가능하다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ANONYMOUS, closePools, withOwner, withRls, type RlsContext } from "@bolsaram/db";

type Fixture = {
  adminId: string;
  member1: RlsContext;
  member2: RlsContext;
  outsider: RlsContext;
  admin: RlsContext;
  p1: string;
  p2: string;
  pOutsider: string;
  pHidden: string;
};

let fx: Fixture;
const TAG = `rlstest-${Date.now()}`;

beforeAll(async () => {
  fx = await withOwner(async (sql) => {
    const user = async (role: string, key: string) => {
      const result = await sql.query<{ id: string }>(
        role === "ADMIN"
          ? `INSERT INTO users (role, email, password_hash, display_name)
             VALUES ('ADMIN', $1, 'x', $2) RETURNING id`
          : `INSERT INTO users (role, phone, display_name) VALUES ('MEMBER', $1, $2) RETURNING id`,
        role === "ADMIN" ? [`${TAG}-${key}@test.local`, key] : [phoneFor(key), key],
      );
      return result.rows[0]!.id;
    };

    const profile = async (userId: string | null, status: string, visibility: string) => {
      const result = await sql.query<{ id: string }>(
        `INSERT INTO profiles (group_id, user_id, gender, birth_year, residence_region, status, visibility, real_name, consent_method)
         VALUES ($1,$2,'FEMALE',1993,'SEOUL',$3,$4,$5,'SYNTHETIC') RETURNING id`,
        [groupId, userId, status, visibility, `${TAG}-이름`],
      );
      return result.rows[0]!.id;
    };

    // 이 테스트의 모든 픽스처는 한 모임에 있다 — 모임 간 격리는
    // tests/group-isolation.test.ts 가 따로 검증한다.
    const groupResult = await sql.query<{ id: string }>(
      `INSERT INTO groups (name) VALUES ($1) RETURNING id`,
      [TAG],
    );
    const groupId = groupResult.rows[0]!.id;

    const adminId = await user("ADMIN", "admin");
    await sql.query(
      `INSERT INTO group_admins (group_id, user_id, is_owner) VALUES ($1, $2, true)`,
      [groupId, adminId],
    );
    const u1 = await user("MEMBER", "m1");
    const u2 = await user("MEMBER", "m2");
    const u3 = await user("MEMBER", "m3");

    return {
      adminId,
      admin: { userId: adminId, role: "ADMIN" as const },
      member1: { userId: u1, role: "MEMBER" as const },
      member2: { userId: u2, role: "MEMBER" as const },
      outsider: { userId: u3, role: "MEMBER" as const },
      p1: await profile(u1, "ACTIVE", "LISTED"),
      p2: await profile(u2, "ACTIVE", "LISTED"),
      pOutsider: await profile(u3, "ACTIVE", "LISTED"),
      pHidden: await profile(null, "INACTIVE", "PRIVATE"),
    };
  });
});

afterAll(async () => {
  // 테스트가 만든 것만 지운다. 시드 데이터는 건드리지 않는다.
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM profiles WHERE real_name = $1`, [`${TAG}-이름`]);
    await sql.query(
      `DELETE FROM users WHERE display_name IN ('admin','m1','m2','m3') AND (email LIKE $1 OR phone LIKE $2)`,
      [`${TAG}-%`, `${phonePrefix()}%`],
    );
    await sql.query(`DELETE FROM groups WHERE name = $1`, [TAG]);
  });
  await closePools();
});

describe("profiles 읽기 정책", () => {
  it("익명은 아무 프로필도 보지 못한다", async () => {
    const result = await withRls(ANONYMOUS, (sql) => sql.query(`SELECT id FROM profiles`));
    expect(result.rowCount).toBe(0);
  });

  it("회원은 비공개(PRIVATE) 프로필을 보지 못한다", async () => {
    const result = await withRls(fx.member1, (sql) =>
      sql.query(`SELECT id FROM profiles WHERE id = $1`, [fx.pHidden]),
    );
    expect(result.rowCount).toBe(0);
  });

  it("관리자는 비공개 프로필도 본다", async () => {
    const result = await withRls(fx.admin, (sql) =>
      sql.query(`SELECT id FROM profiles WHERE id = $1`, [fx.pHidden]),
    );
    expect(result.rowCount).toBe(1);
  });
});

describe("profiles 쓰기 정책", () => {
  it("회원은 남의 프로필을 수정할 수 없다", async () => {
    const result = await withRls(fx.member1, (sql) =>
      sql.query(`UPDATE profiles SET bio = 'hacked' WHERE id = $1`, [fx.p2]),
    );
    expect(result.rowCount).toBe(0);
  });

  it("회원은 자기 프로필도 임의로 수정할 수 없다 — 수정은 주선자의 몫", async () => {
    const result = await withRls(fx.member1, (sql) =>
      sql.query(`UPDATE profiles SET bio = 'self edit' WHERE id = $1`, [fx.p1]),
    );
    expect(result.rowCount).toBe(0);
  });

  it("회원은 프로필을 새로 만들 수 없다", async () => {
    await expect(
      withRls(fx.member1, (sql) =>
        sql.query(
          `INSERT INTO profiles (gender, birth_year, residence_region) VALUES ('MALE',1990,'SEOUL')`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("관리자는 수정할 수 있다", async () => {
    const result = await withRls(fx.admin, (sql) =>
      sql.query(`UPDATE profiles SET bio = 'by admin' WHERE id = $1`, [fx.p1]),
    );
    expect(result.rowCount).toBe(1);
  });
});

describe("match_requests 정책", () => {
  it("남의 명의로 신청할 수 없다", async () => {
    await expect(
      withRls(fx.member1, (sql) =>
        sql.query(
          `INSERT INTO match_requests (requester_profile_id, target_profile_id) VALUES ($1,$2)`,
          [fx.p2, fx.p1],
        ),
      ),
    ).rejects.toThrow();
  });

  it("자기 명의 신청은 만들 수 있다", async () => {
    const result = await withRls(fx.member1, (sql) =>
      sql.query<{ id: string }>(
        `INSERT INTO match_requests (requester_profile_id, target_profile_id) VALUES ($1,$2) RETURNING id`,
        [fx.p1, fx.p2],
      ),
    );
    expect(result.rowCount).toBe(1);
  });

  it("같은 방향의 활성 신청은 중복될 수 없다 (부분 유니크 인덱스)", async () => {
    await expect(
      withRls(fx.member1, (sql) =>
        sql.query(
          `INSERT INTO match_requests (requester_profile_id, target_profile_id) VALUES ($1,$2)`,
          [fx.p1, fx.p2],
        ),
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("자기 자신에게 신청하는 행은 제약으로 막힌다", async () => {
    await expect(
      withOwner((sql) =>
        sql.query(
          `INSERT INTO match_requests (requester_profile_id, target_profile_id) VALUES ($1,$1)`,
          [fx.p1],
        ),
      ),
    ).rejects.toThrow(/match_requests_no_self/);
  });

  it("무관한 제3자는 남의 신청을 보지 못한다", async () => {
    const result = await withRls(fx.outsider, (sql) =>
      sql.query(`SELECT id FROM match_requests`),
    );
    expect(result.rowCount).toBe(0);
  });

  it("당사자 양쪽은 신청을 본다", async () => {
    for (const ctx of [fx.member1, fx.member2]) {
      const result = await withRls(ctx, (sql) =>
        sql.query(`SELECT id FROM match_requests WHERE requester_profile_id = $1`, [fx.p1]),
      );
      expect(result.rowCount).toBe(1);
    }
  });
});

describe("관리자 전용 테이블", () => {
  it("회원은 Import 세션을 보지 못한다", async () => {
    const result = await withRls(fx.member1, (sql) =>
      sql.query(`SELECT id FROM import_sessions`),
    );
    expect(result.rowCount).toBe(0);
  });

  it("회원은 초대를 보지 못한다", async () => {
    const result = await withRls(fx.member1, (sql) => sql.query(`SELECT id FROM invites`));
    expect(result.rowCount).toBe(0);
  });

  it("앱 롤은 세션 테이블에 접근할 수 없다", async () => {
    await expect(
      withRls(fx.member1, (sql) => sql.query(`SELECT id FROM sessions`)),
    ).rejects.toThrow(/permission denied/i);
  });


  it("회원은 감사 로그를 읽지 못한다", async () => {
    const result = await withRls(fx.member1, (sql) => sql.query(`SELECT id FROM audit_logs`));
    expect(result.rowCount).toBe(0);
  });
});

describe("favorites 정책", () => {
  it("남의 이름으로 관심을 저장할 수 없다", async () => {
    await expect(
      withRls(fx.member1, (sql) =>
        sql.query(`INSERT INTO favorites (user_id, profile_id) VALUES ($1,$2)`, [
          fx.member2.userId,
          fx.p1,
        ]),
      ),
    ).rejects.toThrow();
  });

  it("자기 관심은 저장하고 자기 것만 본다", async () => {
    await withRls(fx.member1, (sql) =>
      sql.query(`INSERT INTO favorites (user_id, profile_id) VALUES ($1,$2)`, [
        fx.member1.userId,
        fx.p2,
      ]),
    );
    const mine = await withRls(fx.member1, (sql) => sql.query(`SELECT * FROM favorites`));
    const others = await withRls(fx.member2, (sql) => sql.query(`SELECT * FROM favorites`));
    expect(mine.rowCount).toBe(1);
    expect(others.rowCount).toBe(0);
  });
});

describe("RLS 컨텍스트 격리", () => {
  it("트랜잭션이 끝나면 GUC 가 남지 않는다 — 커넥션 재사용 시 권한이 새지 않는다", async () => {
    await withRls(fx.admin, (sql) => sql.query(`SELECT 1`));
    const leaked = await withRls(ANONYMOUS, (sql) =>
      sql.query<{ role: string | null }>(`SELECT app_current_role() AS role`),
    );
    expect(leaked.rows[0]?.role).toBeNull();
  });

  it("예외가 나면 롤백된다", async () => {
    await expect(
      withRls(fx.admin, async (sql) => {
        await sql.query(`UPDATE profiles SET bio = 'rolled back' WHERE id = $1`, [fx.p1]);
        throw new Error("의도적 실패");
      }),
    ).rejects.toThrow("의도적 실패");

    const after = await withRls(fx.admin, (sql) =>
      sql.query<{ bio: string | null }>(`SELECT bio FROM profiles WHERE id = $1`, [fx.p1]),
    );
    expect(after.rows[0]?.bio).not.toBe("rolled back");
  });
});

function phonePrefix(): string {
  return "0109";
}
function phoneFor(key: string): string {
  const n = { admin: 1, m1: 2, m2: 3, m3: 4 }[key] ?? 9;
  return `${phonePrefix()}${String(Date.now()).slice(-6)}${n}`;
}
