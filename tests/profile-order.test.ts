/**
 * 목록 정렬 통합 테스트.
 *
 * 지키는 성질은 두 가지다.
 *   * 사진 없는 프로필은 사진 있는 프로필 **뒤로** 간다. 카드 그리드가 빈 회색으로
 *     시작하면 첫 화면을 못 쓴다.
 *   * 그 정렬이 **커서 경계를 넘어서도** 유지된다. 정렬 키가 셋인데 커서가 둘만
 *     싣고 있으면 페이지 경계에서 행이 겹치거나 빠진다 — 여기서 그걸 막는다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withOwner, withRls, type RlsContext } from "@bolsaram/db";
import { discoverQuerySchema, adminProfileQuerySchema } from "@bolsaram/schemas";
import { findAdminProfiles, findDiscoverProfiles } from "../apps/web/src/server/repo/profiles";

const TAG = `ordertest-${Date.now()}`;

/** 오래된 순으로 넣는다. 사진 유무를 번갈아 둬야 두 축이 섞인 정렬을 검증할 수 있다. */
const FIXTURES = [
  { key: "old-photo", photo: true, days: 4 },
  { key: "old-bare", photo: false, days: 3 },
  { key: "new-photo", photo: true, days: 2 },
  { key: "new-bare", photo: false, days: 1 },
] as const;

/** 사진 있는 쪽 최신순 → 사진 없는 쪽 최신순. */
const EXPECTED = ["new-photo", "old-photo", "new-bare", "old-bare"];

const ids = new Map<string, string>();
const names = new Map<string, string>();
let admin: RlsContext;
let member: RlsContext;
let viewerProfileId: string;
let groupId: string;

beforeAll(async () => {
  const fixture = await withOwner(async (sql) => {
    const g = await sql.query<{ id: string }>(
      `INSERT INTO groups (name) VALUES ($1) RETURNING id`,
      [TAG],
    );
    const gid = g.rows[0]!.id;

    const a = await sql.query<{ id: string }>(
      `INSERT INTO users (role, email, password_hash, display_name)
       VALUES ('ADMIN', $1, 'x', $2) RETURNING id`,
      [`${TAG}-admin@test.local`, `${TAG}-admin`],
    );
    const adminId = a.rows[0]!.id;
    await sql.query(
      `INSERT INTO group_admins (group_id, user_id, is_owner) VALUES ($1, $2, true)`,
      [gid, adminId],
    );

    const m = await sql.query<{ id: string }>(
      `INSERT INTO users (role, phone, display_name) VALUES ('MEMBER', $1, $2) RETURNING id`,
      [`0109${String(Date.now()).slice(-7)}`, `${TAG}-viewer`],
    );
    const memberId = m.rows[0]!.id;

    const insertProfile = async (name: string, days: number, userId: string | null) => {
      const r = await sql.query<{ id: string }>(
        `INSERT INTO profiles (group_id, user_id, gender, birth_year, residence_region,
                               status, visibility, real_name, created_by, created_at)
         VALUES ($1, $2, 'FEMALE', 1993, 'SEOUL', 'ACTIVE', 'LISTED', $3, $4,
                 now() - make_interval(days => $5))
         RETURNING id`,
        [gid, userId, name, adminId, days],
      );
      return r.rows[0]!.id;
    };

    const viewer = await insertProfile(`${TAG}-viewer`, 9, memberId);

    for (const f of FIXTURES) {
      const name = `${TAG}-${f.key}`;
      const id = await insertProfile(name, f.days, null);
      ids.set(f.key, id);
      names.set(id, f.key);
      if (f.photo) {
        await sql.query(
          `INSERT INTO profile_images (profile_id, storage_key, mime_type, byte_size, is_primary)
           VALUES ($1, $2, 'image/jpeg', 100, true)`,
          [id, `${TAG}/${f.key}.jpg`],
        );
      }
    }

    return { gid, adminId, memberId, viewer };
  });

  groupId = fixture.gid;
  admin = { userId: fixture.adminId, role: "ADMIN" };
  member = { userId: fixture.memberId, role: "MEMBER" };
  viewerProfileId = fixture.viewer;
});

afterAll(async () => {
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM profiles WHERE group_id = $1`, [groupId]);
    await sql.query(`DELETE FROM users WHERE display_name LIKE $1`, [`${TAG}%`]);
    await sql.query(`DELETE FROM groups WHERE id = $1`, [groupId]);
  });
  await closePools();
});

/** 픽스처가 아닌 프로필(다른 테스트·시드)은 걸러 내고 우리 것만 순서대로 본다. */
function labels(items: { id: string }[]): string[] {
  return items.map((i) => names.get(i.id)).filter((n): n is string => n != null);
}

describe("회원 Discover", () => {
  it("사진 있는 프로필을 먼저, 그 안에서 최신순으로 준다", async () => {
    const page = await withRls(member, (sql) =>
      findDiscoverProfiles(sql, discoverQuerySchema.parse({ limit: 60 }), viewerProfileId),
    );
    expect(labels(page.items)).toEqual(EXPECTED);
  });

  it("커서로 넘어가도 순서가 이어지고 겹치거나 빠지지 않는다", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    // 픽스처 넷을 한 장에 담지 못하는 크기로 끊어 경계를 실제로 지나가게 한다.
    for (let page = 0; page < 20; page += 1) {
      const result = await withRls(member, (sql) =>
        findDiscoverProfiles(
          sql,
          discoverQuerySchema.parse(cursor ? { limit: 1, cursor } : { limit: 1 }),
          viewerProfileId,
        ),
      );
      seen.push(...labels(result.items));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(seen).toEqual(EXPECTED);
  });
});

describe("주선자 프로필 목록", () => {
  it("같은 정렬을 쓴다", async () => {
    const page = await withRls(admin, (sql) =>
      findAdminProfiles(sql, adminProfileQuerySchema.parse({ limit: 100 }), { groupId }),
    );
    expect(labels(page.items)).toEqual(EXPECTED);
  });

  it("커서 경계에서도 순서가 유지된다", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 40; page += 1) {
      const result = await withRls(admin, (sql) =>
        findAdminProfiles(
          sql,
          adminProfileQuerySchema.parse(cursor ? { limit: 2, cursor } : { limit: 2 }),
          { groupId },
        ),
      );
      seen.push(...labels(result.items));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(seen).toEqual(EXPECTED);
  });
});
