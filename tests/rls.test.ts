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
  /** 같은 모임이 아닌 주선자. 대행 경계를 확인하는 데 쓴다. */
  strangerAdmin: RlsContext;
  p1: string;
  p2: string;
  pOutsider: string;
  pHidden: string;
  /** 관계가 없는 깨끗한 쌍. 거절·숨김 테스트는 쌍에 흔적을 남긴다. */
  member4: RlsContext;
  p4: string;
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
        `INSERT INTO profiles (group_id, user_id, gender, birth_year, residence_region, status, visibility, real_name)
         VALUES ($1,$2,'FEMALE',1993,'SEOUL',$3,$4,$5) RETURNING id`,
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
    // 모임에 넣지 않는다 — group_admins 행이 없으므로 이 픽스처의 프로필을 고칠 수 없다.
    const strangerAdminId = await user("ADMIN", "admin2");
    const u1 = await user("MEMBER", "m1");
    const u2 = await user("MEMBER", "m2");
    const u3 = await user("MEMBER", "m3");
    const u4 = await user("MEMBER", "m4");

    return {
      adminId,
      admin: { userId: adminId, role: "ADMIN" as const },
      strangerAdmin: { userId: strangerAdminId, role: "ADMIN" as const },
      member1: { userId: u1, role: "MEMBER" as const },
      member2: { userId: u2, role: "MEMBER" as const },
      outsider: { userId: u3, role: "MEMBER" as const },
      p1: await profile(u1, "ACTIVE", "LISTED"),
      p2: await profile(u2, "ACTIVE", "LISTED"),
      pOutsider: await profile(u3, "ACTIVE", "LISTED"),
      pHidden: await profile(null, "INACTIVE", "PRIVATE"),
      member4: { userId: u4, role: "MEMBER" as const },
      p4: await profile(u4, "ACTIVE", "LISTED"),
    };
  });
});

afterAll(async () => {
  // 테스트가 만든 것만 지운다. 시드 데이터는 건드리지 않는다.
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM profiles WHERE real_name = $1`, [`${TAG}-이름`]);
    await sql.query(
      `DELETE FROM users WHERE display_name IN ('admin','admin2','m1','m2','m3','m4') AND (email LIKE $1 OR phone LIKE $2)`,
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

  /**
   * 종료해도 공개는 유지된다(0022). 이름·연락처를 여는 판정이 RLS 와 애플리케이션
   * 레이어에 두 벌 있으므로, 한쪽만 고쳐 갈라지지 않는지 여기서 잡는다.
   */
  it("연결이 종료돼도 이름·연락처 공개 판정은 유지된다", async () => {
    const introducedWith = (ctx: typeof fx.member1) =>
      withRls(ctx, async (sql) => {
        const r = await sql.query<{ ok: boolean }>(
          `SELECT app_is_introduced_with($1) AS ok`,
          [fx.p2],
        );
        return r.rows[0]!.ok;
      });

    const setStatus = (status: string) =>
      withOwner((sql) =>
        sql.query(`UPDATE match_requests SET status = $1 WHERE requester_profile_id = $2`, [
          status,
          fx.p1,
        ]),
      );

    await setStatus("REQUESTED");
    expect(await introducedWith(fx.member1)).toBe(false);

    await setStatus("INTRODUCED");
    expect(await introducedWith(fx.member1)).toBe(true);

    await setStatus("CLOSED");
    expect(await introducedWith(fx.member1)).toBe(true);

    // 거절로 끝난 건은 연결된 적이 없다.
    await setStatus("REJECTED");
    expect(await introducedWith(fx.member1)).toBe(false);
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

describe("주선자 대행", () => {
  /** 대행 컨텍스트에서 회원으로 인식되는 프로필. NULL 이면 대행이 성립하지 않은 것이다. */
  async function actingAs(ctx: RlsContext, profileId: string): Promise<string | null> {
    const result = await withRls({ ...ctx, actingProfileId: profileId }, (sql) =>
      sql.query<{ id: string | null }>(`SELECT app_current_profile_id() AS id`),
    );
    return result.rows[0]?.id ?? null;
  }

  it("본인 계정이 연결된 프로필도 대행한다", async () => {
    // 0035 에서 연결 여부를 조건에서 뺐다 — 연결은 초대를 한 번 열었다는 뜻일 뿐이다.
    expect(await actingAs(fx.admin, fx.p1)).toBe(fx.p1);
  });

  it("아직 연결되지 않은 프로필도 대행한다", async () => {
    expect(await actingAs(fx.admin, fx.pHidden)).toBe(fx.pHidden);
  });

  it("고칠 수 없는 프로필은 대행하지 못한다", async () => {
    // 모임 밖 주선자다. 연결 여부와 무관하게 app_can_edit_profile 이 막는다.
    expect(await actingAs(fx.strangerAdmin, fx.p1)).toBeNull();
    expect(await actingAs(fx.strangerAdmin, fx.pHidden)).toBeNull();
  });

  it("회원은 대행하지 못한다 — 자기 프로필로 떨어진다", async () => {
    // 대행 값을 직접 넣어도 app_is_admin() 이 막고 COALESCE 가 본인 프로필을 준다.
    expect(await actingAs(fx.member2, fx.p1)).toBe(fx.p2);
  });

  it("대행하지 않는 주선자에게는 회원 프로필이 없다", async () => {
    // COALESCE 의 두 번째 가지. 주선자 계정에는 프로필이 붙지 않으므로 NULL 이다.
    const result = await withRls(fx.admin, (sql) =>
      sql.query<{ id: string | null }>(`SELECT app_current_profile_id() AS id`),
    );
    expect(result.rows[0]?.id).toBeNull();
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

/**
 * 거절·숨김 관계 (마이그레이션 0023).
 *
 * 여기서 지키는 성질은 두 가지다 — **다시 신청할 수 없다**, 그리고 **누가 숨겼는지
 * 알 수 없다**. 뒤쪽이 더 중요하다: 상대에게 보이면 숨기기가 통보가 된다.
 */
describe("거절·숨김 관계", () => {
  it("거절 이력이 있으면 어느 방향으로도 새 신청이 막힌다", async () => {
    await withRls(fx.member1, (sql) =>
      sql.query(
        `INSERT INTO match_requests (requester_profile_id, target_profile_id) VALUES ($1,$2)`,
        [fx.p1, fx.pOutsider],
      ),
    );
    await withOwner((sql) =>
      sql.query(
        `UPDATE match_requests SET status = 'REJECTED'
          WHERE requester_profile_id = $1 AND target_profile_id = $2`,
        [fx.p1, fx.pOutsider],
      ),
    );

    // 같은 방향
    await expect(
      withRls(fx.member1, (sql) =>
        sql.query(
          `INSERT INTO match_requests (requester_profile_id, target_profile_id) VALUES ($1,$2)`,
          [fx.p1, fx.pOutsider],
        ),
      ),
    ).rejects.toThrow(/거절된 관계/);

    // 반대 방향 — 거절한 쪽이 나중에 마음을 바꿔도 열리지 않는다.
    await expect(
      withRls(fx.outsider, (sql) =>
        sql.query(
          `INSERT INTO match_requests (requester_profile_id, target_profile_id) VALUES ($1,$2)`,
          [fx.pOutsider, fx.p1],
        ),
      ),
    ).rejects.toThrow(/거절된 관계/);
  });

  it("남의 이름으로 숨길 수 없다", async () => {
    await expect(
      withRls(fx.member2, (sql) =>
        sql.query(
          `INSERT INTO profile_hides (hider_profile_id, hidden_profile_id) VALUES ($1,$2)`,
          [fx.pOutsider, fx.p2],
        ),
      ),
    ).rejects.toThrow();
  });

  it("자기 자신을 숨기는 행은 제약으로 막힌다", async () => {
    await expect(
      withOwner((sql) =>
        sql.query(
          `INSERT INTO profile_hides (hider_profile_id, hidden_profile_id) VALUES ($1,$1)`,
          [fx.p2],
        ),
      ),
    ).rejects.toThrow(/profile_hides_no_self/);
  });

  it("숨긴 사실은 숨긴 사람만 읽는다 — 상대도 주선자도 보지 못한다", async () => {
    await withRls(fx.member2, (sql) =>
      sql.query(
        `INSERT INTO profile_hides (hider_profile_id, hidden_profile_id) VALUES ($1,$2)`,
        [fx.p2, fx.pOutsider],
      ),
    );

    const mine = await withRls(fx.member2, (sql) =>
      sql.query(`SELECT 1 FROM profile_hides`),
    );
    expect(mine.rowCount).toBe(1);

    // 숨겨진 당사자에게는 한 행도 보이지 않는다.
    const theirs = await withRls(fx.outsider, (sql) =>
      sql.query(`SELECT 1 FROM profile_hides`),
    );
    expect(theirs.rowCount).toBe(0);

    // 주선자에게도 정책을 주지 않았다. 신고가 아니라 숨기기다.
    const admin = await withRls(fx.admin, (sql) => sql.query(`SELECT 1 FROM profile_hides`));
    expect(admin.rowCount).toBe(0);
  });

  it("숨김 판정은 양방향이다 — 상대도 신청할 수 없다", async () => {
    const hiddenBetween = (ctx: typeof fx.member2, other: string) =>
      withRls(ctx, async (sql) => {
        const r = await sql.query<{ ok: boolean }>(`SELECT app_is_hidden_between($1) AS ok`, [
          other,
        ]);
        return r.rows[0]!.ok;
      });

    expect(await hiddenBetween(fx.member2, fx.pOutsider)).toBe(true);
    // 숨겨진 쪽은 행을 볼 수 없지만 판정은 같게 나온다(DEFINER 함수).
    expect(await hiddenBetween(fx.outsider, fx.p2)).toBe(true);

    await expect(
      withRls(fx.outsider, (sql) =>
        sql.query(
          `INSERT INTO match_requests (requester_profile_id, target_profile_id) VALUES ($1,$2)`,
          [fx.pOutsider, fx.p2],
        ),
      ),
    ).rejects.toThrow(/숨긴 관계/);
  });

  it("탐색 제외 목록에 거절·숨김 상대가 담긴다", async () => {
    const excluded = (ctx: typeof fx.member1) =>
      withRls(ctx, async (sql) => {
        const r = await sql.query<{ id: string }>(
          `SELECT app_discover_excluded_profile_ids() AS id`,
        );
        return r.rows.map((row) => row.id);
      });

    // member1 은 pOutsider 를 거절 이력으로, p2 는 앞선 테스트가 남긴 거절로 뺀다.
    expect(await excluded(fx.member1)).toContain(fx.pOutsider);
    // member2 는 숨김으로 pOutsider 를 뺀다.
    expect(await excluded(fx.member2)).toContain(fx.pOutsider);
    // 숨겨진 쪽에서도 상대가 빠진다 — 한쪽만 안 보이면 목록과 신청 가능 여부가 어긋난다.
    expect(await excluded(fx.outsider)).toContain(fx.p2);
  });

  it("프로필이 없는 주선자에게는 제외 목록이 비어 있다", async () => {
    const result = await withRls(fx.admin, (sql) =>
      sql.query(`SELECT app_discover_excluded_profile_ids() AS id`),
    );
    expect(result.rowCount).toBe(0);
  });

  /**
   * 숨김 + 활성 신청이 겹치면 되돌릴 수 없는 상태가 된다(0024). 두 트리거가 서로
   * 반대 방향을 막으므로, 어느 순서로 시도해도 그 조합이 만들어지지 않아야 한다.
   */
  it("활성 신청이 있는 상대는 숨길 수 없다 — 순서를 바꿔도 조합이 생기지 않는다", async () => {
    await withRls(fx.member4, (sql) =>
      sql.query(
        `INSERT INTO match_requests (requester_profile_id, target_profile_id) VALUES ($1,$2)`,
        [fx.p4, fx.pOutsider],
      ),
    );

    // 보낸 쪽도, 받은 쪽도 숨길 수 없다.
    for (const [ctx, hider, hidden] of [
      [fx.member4, fx.p4, fx.pOutsider],
      [fx.outsider, fx.pOutsider, fx.p4],
    ] as const) {
      await expect(
        withRls(ctx, (sql) =>
          sql.query(
            `INSERT INTO profile_hides (hider_profile_id, hidden_profile_id) VALUES ($1,$2)`,
            [hider, hidden],
          ),
        ),
      ).rejects.toThrow(/진행 중인 신청/);
    }

    // 신청이 정리되면 숨길 수 있다.
    await withOwner((sql) =>
      sql.query(
        `UPDATE match_requests SET status = 'CANCELED'
          WHERE requester_profile_id = $1 AND target_profile_id = $2`,
        [fx.p4, fx.pOutsider],
      ),
    );
    const after = await withRls(fx.member4, (sql) =>
      sql.query(
        `INSERT INTO profile_hides (hider_profile_id, hidden_profile_id) VALUES ($1,$2)`,
        [fx.p4, fx.pOutsider],
      ),
    );
    expect(after.rowCount).toBe(1);

    // 그리고 숨긴 뒤에는 신청이 다시 열리지 않는다 — 반대 방향도 막힌다.
    await expect(
      withRls(fx.outsider, (sql) =>
        sql.query(
          `INSERT INTO match_requests (requester_profile_id, target_profile_id) VALUES ($1,$2)`,
          [fx.pOutsider, fx.p4],
        ),
      ),
    ).rejects.toThrow(/숨긴 관계/);
  });
});
