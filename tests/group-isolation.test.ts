/**
 * 모임(테넌트) 격리 통합 테스트.
 *
 * 주선자 자유 가입을 열기 때문에 **이 격리가 서비스의 마지막 방어선**이다.
 * 이전에는 관리자 정책이 `app_is_admin()` 하나였고, ADMIN 계정 하나로 전체 회원의
 * 이름·연락처·사진에 접근할 수 있었다.
 *
 * 여기서 지키는 성질 — 모두 "안 되는 것"이다.
 *   * 다른 모임의 주선자는 남의 회원을 읽지도 고치지도 못한다.
 *   * 회원은 자기 모임 안의 프로필만 본다.
 *   * 모임을 넘는 소개 신청을 만들 수 없다.
 *   * Import·초대·텔레그램 대화도 모임 밖으로 새지 않는다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withOwner, withRls, type RlsContext } from "@bolsaram/db";
import { assertCanEditProfile } from "../apps/web/src/server/repo/profiles";
import { createSession, setSessionGroup } from "../apps/web/src/server/repo/imports";

const TAG = `grouptest-${Date.now()}`;

type Party = {
  groupId: string;
  admin: RlsContext;
  adminId: string;
  member: RlsContext;
  profileId: string;
};

let A: Party;
let B: Party;

async function makeParty(sql: Parameters<Parameters<typeof withOwner>[0]>[0], key: string) {
  const g = await sql.query<{ id: string }>(
    `INSERT INTO groups (name) VALUES ($1) RETURNING id`,
    [`${TAG}-${key}`],
  );
  const groupId = g.rows[0]!.id;

  const a = await sql.query<{ id: string }>(
    `INSERT INTO users (role, email, password_hash, display_name)
     VALUES ('ADMIN', $1, 'x', $2) RETURNING id`,
    [`${TAG}-${key}-admin@test.local`, `${TAG}-${key}-admin`],
  );
  const adminId = a.rows[0]!.id;
  await sql.query(
    `INSERT INTO group_admins (group_id, user_id, is_owner) VALUES ($1, $2, true)`,
    [groupId, adminId],
  );

  const m = await sql.query<{ id: string }>(
    `INSERT INTO users (role, phone, display_name) VALUES ('MEMBER', $1, $2) RETURNING id`,
    [`0107${String(Date.now()).slice(-6)}${key === "a" ? "1" : "2"}`, `${TAG}-${key}-member`],
  );
  const memberId = m.rows[0]!.id;

  const p = await sql.query<{ id: string }>(
    `INSERT INTO profiles (group_id, user_id, gender, birth_year, residence_region,
                           status, visibility, real_name, created_by)
     VALUES ($1, $2, 'FEMALE', 1993, 'SEOUL', 'ACTIVE', 'LISTED', $3, $4) RETURNING id`,
    [groupId, memberId, `${TAG}-${key}-이름`, adminId],
  );

  return {
    groupId,
    adminId,
    admin: { userId: adminId, role: "ADMIN" as const },
    member: { userId: memberId, role: "MEMBER" as const },
    profileId: p.rows[0]!.id,
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

describe("주선자는 자기 모임만 다룬다", () => {
  it("남의 모임 프로필을 읽지 못한다", async () => {
    const rows = await withRls(A.admin, async (sql) => {
      const r = await sql.query(`SELECT id FROM profiles WHERE id = $1`, [B.profileId]);
      return r.rowCount ?? 0;
    });
    expect(rows).toBe(0);
  });

  it("자기 모임 프로필은 읽는다", async () => {
    const rows = await withRls(A.admin, async (sql) => {
      const r = await sql.query(`SELECT id FROM profiles WHERE id = $1`, [A.profileId]);
      return r.rowCount ?? 0;
    });
    expect(rows).toBe(1);
  });

  it("남의 모임 프로필을 고치지 못한다", async () => {
    const updated = await withRls(A.admin, async (sql) => {
      const r = await sql.query(`UPDATE profiles SET bio = 'hacked' WHERE id = $1`, [
        B.profileId,
      ]);
      return r.rowCount ?? 0;
    });
    expect(updated).toBe(0);
  });

  it("남의 모임에 프로필을 만들지 못한다", async () => {
    await expect(
      withRls(A.admin, (sql) =>
        sql.query(
          `INSERT INTO profiles (group_id, gender, birth_year, residence_region)
           VALUES ($1, 'MALE', 1990, 'SEOUL')`,
          [B.groupId],
        ),
      ),
    ).rejects.toThrow();
  });

  it("남의 모임 사진 메타데이터를 쓰지 못한다", async () => {
    await expect(
      withRls(A.admin, (sql) =>
        sql.query(
          `INSERT INTO profile_images (profile_id, storage_key, mime_type, byte_size, sort_order)
           VALUES ($1, 'x/y.jpg', 'image/jpeg', 100, 0)`,
          [B.profileId],
        ),
      ),
    ).rejects.toThrow();
  });

  it("남의 모임 초대를 다루지 못한다", async () => {
    await expect(
      withRls(A.admin, (sql) =>
        sql.query(
          `INSERT INTO invites (profile_id, token_hash, expires_at)
           VALUES ($1, $2, now() + interval '1 day')`,
          [B.profileId, `${TAG}-hash`],
        ),
      ),
    ).rejects.toThrow();
  });

  /**
   * 초대 발급은 owner 커넥션을 쓰므로 위 정책을 지나간다. 초대 링크는 곧 그 회원의
   * 로그인 수단이라, 애플리케이션 레이어가 같은 판정을 다시 해야 한다.
   */
  it("남의 모임 프로필에는 초대를 발급할 권한이 없다", async () => {
    await expect(
      withRls(A.admin, (sql) => assertCanEditProfile(sql, B.profileId)),
    ).rejects.toThrow(/권한이 없습니다/);
  });

  it("자기 모임 프로필은 발급할 수 있다", async () => {
    await expect(
      withRls(A.admin, (sql) => assertCanEditProfile(sql, A.profileId)),
    ).resolves.toBeUndefined();
  });

  it("남의 모임 Import 세션을 읽지 못한다", async () => {
    const sessionId = await withOwner(async (sql) => {
      const r = await sql.query<{ id: string }>(
        `INSERT INTO import_sessions (group_id, created_by, source, raw_text)
         VALUES ($1, $2, 'TEXT', $3) RETURNING id`,
        [B.groupId, B.adminId, `${TAG} 원문`],
      );
      return r.rows[0]!.id;
    });
    const rows = await withRls(A.admin, async (sql) => {
      const r = await sql.query(`SELECT id FROM import_sessions WHERE id = $1`, [sessionId]);
      return r.rowCount ?? 0;
    });
    expect(rows).toBe(0);
  });
});

describe("회원은 자기 모임 안에서만 본다", () => {
  it("다른 모임의 공개 프로필이 보이지 않는다", async () => {
    const rows = await withRls(A.member, async (sql) => {
      const r = await sql.query(`SELECT id FROM profiles WHERE id = $1`, [B.profileId]);
      return r.rowCount ?? 0;
    });
    expect(rows).toBe(0);
  });

  it("같은 모임의 공개 프로필은 보인다", async () => {
    // 자기 프로필이라도 보여야 한다(내 프로필 화면).
    const rows = await withRls(A.member, async (sql) => {
      const r = await sql.query(`SELECT id FROM profiles WHERE id = $1`, [A.profileId]);
      return r.rowCount ?? 0;
    });
    expect(rows).toBe(1);
  });

  it("모임을 넘는 소개 신청을 만들 수 없다", async () => {
    await expect(
      withRls(A.member, (sql) =>
        sql.query(
          `INSERT INTO match_requests (requester_profile_id, target_profile_id)
           VALUES ($1, $2)`,
          [A.profileId, B.profileId],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("주인 없는 프로필 가로채기", () => {
  it("로그인만 한 사람이 남의 프로필을 자기 것으로 만들 수 없다", async () => {
    // 0013 이전에는 profiles_claim 정책이 이걸 허용했다 — 초대 토큰도 모임도 보지
    // 않았다. claim 은 해시 토큰 검증을 통과한 인증 레이어에서만 일어나야 한다.
    const orphanProfile = await withOwner(async (sql) => {
      const r = await sql.query<{ id: string }>(
        `INSERT INTO profiles (group_id, gender, birth_year, residence_region, real_name)
         VALUES ($1,'MALE',1991,'BUSAN',$2) RETURNING id`,
        [B.groupId, `${TAG}-주인없음`],
      );
      return r.rows[0]!.id;
    });

    const stolen = await withRls(A.member, async (sql) => {
      const r = await sql.query(`UPDATE profiles SET user_id = $2 WHERE id = $1`, [
        orphanProfile,
        A.member.userId,
      ]);
      return r.rowCount ?? 0;
    });
    expect(stolen).toBe(0);

    // 주선자도 마찬가지다 — 남의 모임 프로필은 손댈 수 없다.
    const byAdmin = await withRls(A.admin, async (sql) => {
      const r = await sql.query(`UPDATE profiles SET user_id = $2 WHERE id = $1`, [
        orphanProfile,
        A.admin.userId,
      ]);
      return r.rowCount ?? 0;
    });
    expect(byAdmin).toBe(0);
  });
});

describe("모임에 속하지 않은 주선자", () => {
  it("모임 소속 프로필은 보지 못한다 (전체공개는 본다)", async () => {
    const orphan = await withOwner(async (sql) => {
      const r = await sql.query<{ id: string }>(
        `INSERT INTO users (role, email, password_hash, display_name)
         VALUES ('ADMIN', $1, 'x', $2) RETURNING id`,
        [`${TAG}-orphan@test.local`, `${TAG}-orphan`],
      );
      return { userId: r.rows[0]!.id, role: "ADMIN" as const };
    });
    // 모임 소속 프로필은 보이지 않는다 — 자유 가입의 안전판이다.
    // (전체공개 프로필은 보이는 게 정상이므로 전체 개수를 세면 안 된다.
    //  전체 개수로 단정하면 전체공개 풀이 비었을 때만 통과하는 약한 테스트가 된다.)
    const visible = await withRls(orphan, async (sql) => {
      const r = await sql.query(`SELECT id FROM profiles WHERE id = ANY($1)`, [
        [A.profileId, B.profileId],
      ]);
      return r.rowCount ?? 0;
    });
    expect(visible).toBe(0);

    // 전체공개 프로필은 반대로 보여야 한다.
    const publicId = await withOwner(async (sql) => {
      const r = await sql.query<{ id: string }>(
        `INSERT INTO profiles (group_id, gender, birth_year, residence_region,
                               status, visibility, real_name)
         VALUES (NULL,'FEMALE',1996,'SEOUL','ACTIVE','LISTED',$1) RETURNING id`,
        [`${TAG}-전체공개`],
      );
      return r.rows[0]!.id;
    });
    const seesPublic = await withRls(orphan, async (sql) => {
      const r = await sql.query(`SELECT id FROM profiles WHERE id = $1`, [publicId]);
      return r.rowCount ?? 0;
    });
    expect(seesPublic).toBe(1);
  });
});

describe("가져온 것을 다른 모임으로 옮기기", () => {
  it("두 모임에 다 속하면 옮길 수 있다", async () => {
    // A 의 주선자를 B 에도 넣는다. 여러 모임에 속하는 것이 정상이다.
    await withOwner((sql) =>
      sql.query(
        `INSERT INTO group_admins (group_id, user_id, is_owner) VALUES ($1, $2, false)`,
        [B.groupId, A.adminId],
      ),
    );

    const moved = await withRls(A.admin, async (sql) => {
      const session = await createSession(sql, {
        groupId: A.groupId,
        createdBy: A.adminId,
        source: "TEXT",
      });
      const after = await setSessionGroup(sql, session.id, B.groupId);
      return after.groupId;
    });
    expect(moved).toBe(B.groupId);

    await withOwner((sql) =>
      sql.query(`DELETE FROM group_admins WHERE group_id = $1 AND user_id = $2`, [
        B.groupId,
        A.adminId,
      ]),
    );
  });

  it("속하지 않은 모임으로는 옮길 수 없다", async () => {
    await expect(
      withRls(A.admin, async (sql) => {
        const session = await createSession(sql, {
          groupId: A.groupId,
          createdBy: A.adminId,
          source: "TEXT",
        });
        // RLS 의 WITH CHECK 가 막는다 — 애플리케이션 레이어를 지나쳐도 통과하지 못한다.
        return setSessionGroup(sql, session.id, B.groupId);
      }),
    ).rejects.toThrow();
  });

  it("이미 등록한 세션은 옮길 수 없다", async () => {
    await expect(
      withRls(A.admin, async (sql) => {
        const session = await createSession(sql, {
          groupId: A.groupId,
          createdBy: A.adminId,
          source: "TEXT",
        });
        await sql.query(
          `UPDATE import_sessions
              SET status = 'IMPORTED', committed_profile_id = $2, committed_at = now()
            WHERE id = $1`,
          [session.id, A.profileId],
        );
        return setSessionGroup(sql, session.id, null);
      }),
    ).rejects.toThrow(/이미 등록한 세션/);
  });
});
