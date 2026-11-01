/**
 * 프로필 사진 통합 테스트.
 *
 * 지키는 성질은 둘이다.
 *   - **한 프로필에 사진은 `PROFILE_IMAGE_MAX_COUNT` 장까지.** 애플리케이션(`addImage`)과
 *     DB 트리거(0054)가 각각 막는지 따로 확인한다. 화면이 미리 세는 것은 안내일 뿐이다.
 *   - **대표는 첫 장이다.** 대표로·한 칸 이동이 순서와 대표를 함께 맞추고, 어긋난 옛
 *     데이터도 읽을 때 대표를 맨 앞에 세운다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withOwner, withRls, type RlsContext } from "@bolsaram/db";
import { PROFILE_IMAGE_MAX_COUNT } from "@bolsaram/schemas";
import {
  addImage,
  countImages,
  listImages,
  moveImage,
  setPrimaryImage,
} from "../apps/web/src/server/repo/profile-images";
import { runTag } from "./tags";

const TAG = runTag("img");
let admin: RlsContext;
let groupId: string;
let profileId: string;

beforeAll(async () => {
  const fixture = await withOwner(async (sql) => {
    const g = await sql.query<{ id: string }>(
      `INSERT INTO groups (name) VALUES ($1) RETURNING id`,
      [TAG],
    );
    const group = g.rows[0]!.id;
    const u = await sql.query<{ id: string }>(
      `INSERT INTO users (role, email, display_name)
       VALUES ('ADMIN', $1, $2) RETURNING id`,
      [`${TAG}@test.local`, TAG],
    );
    const userId = u.rows[0]!.id;
    await sql.query(
      `INSERT INTO group_admins (group_id, user_id, is_owner) VALUES ($1, $2, true)`,
      [group, userId],
    );
    const p = await sql.query<{ id: string }>(
      `INSERT INTO profiles (group_id, gender, birth_year, residence_region, created_by)
       VALUES ($1, 'FEMALE', 1993, 'SEOUL', $2) RETURNING id`,
      [group, userId],
    );
    return { group, userId, profile: p.rows[0]!.id };
  });
  groupId = fixture.group;
  profileId = fixture.profile;
  admin = { userId: fixture.userId, role: "ADMIN" };
});

afterAll(async () => {
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM profile_images WHERE profile_id = $1`, [profileId]);
    await sql.query(`DELETE FROM profiles WHERE id = $1`, [profileId]);
    await sql.query(`DELETE FROM users WHERE id = $1`, [admin.userId]);
    await sql.query(`DELETE FROM groups WHERE id = $1`, [groupId]);
  });
  await closePools();
});

describe("프로필 사진 상한", () => {
  it(`${PROFILE_IMAGE_MAX_COUNT}장까지 붙고 그 다음은 사람이 읽을 메시지로 막힌다`, async () => {
    await withRls(admin, async (sql) => {
      for (let i = 0; i < PROFILE_IMAGE_MAX_COUNT; i += 1) {
        await addImage(sql, {
          profileId,
          storageKey: `${TAG}/ok-${i}`,
          mimeType: "image/jpeg",
          byteSize: 100,
        });
      }
      expect(await countImages(sql, profileId)).toBe(PROFILE_IMAGE_MAX_COUNT);

      await expect(
        addImage(sql, {
          profileId,
          storageKey: `${TAG}/over`,
          mimeType: "image/jpeg",
          byteSize: 100,
        }),
      ).rejects.toThrow(new RegExp(`최대 ${PROFILE_IMAGE_MAX_COUNT}장`));
    });
  });

  it("애플리케이션을 건너뛴 INSERT 도 DB 가 막는다", async () => {
    // 상한이 화면이나 서비스 코드에만 있으면 경쟁 상태에서 넘을 수 있다.
    await expect(
      withOwner((sql) =>
        sql.query(
          `INSERT INTO profile_images (profile_id, storage_key, mime_type, byte_size, sort_order, is_primary)
           VALUES ($1, $2, 'image/jpeg', 100, 99, false)`,
          [profileId, `${TAG}/raw-over`],
        ),
      ),
    ).rejects.toThrow(/최대 5장/);

    const count = await withOwner((sql) => countImages(sql, profileId));
    expect(count).toBe(PROFILE_IMAGE_MAX_COUNT);
  });
});

describe("사진 순서와 대표", () => {
  let orderProfileId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    orderProfileId = await withOwner(async (sql) => {
      const p = await sql.query<{ id: string }>(
        `INSERT INTO profiles (group_id, gender, birth_year, residence_region, created_by)
         VALUES ($1, 'MALE', 1990, 'SEOUL', $2) RETURNING id`,
        [groupId, admin.userId],
      );
      return p.rows[0]!.id;
    });
    await withRls(admin, async (sql) => {
      for (const name of ["a", "b", "c"]) {
        const image = await addImage(sql, {
          profileId: orderProfileId,
          storageKey: `${TAG}/order-${name}`,
          mimeType: "image/jpeg",
          byteSize: 100,
        });
        ids[name] = image.id;
      }
    });
  });

  afterAll(async () => {
    await withOwner(async (sql) => {
      await sql.query(`DELETE FROM profile_images WHERE profile_id = $1`, [orderProfileId]);
      await sql.query(`DELETE FROM profiles WHERE id = $1`, [orderProfileId]);
    });
  });

  async function order(): Promise<string[]> {
    const images = await withRls(admin, (sql) => listImages(sql, orderProfileId));
    const names = Object.fromEntries(Object.entries(ids).map(([name, id]) => [id, name]));
    return images.map((image) => (image.isPrimary ? `*${names[image.id]}` : names[image.id]!));
  }

  it("대표로 고르면 맨 앞으로 간다", async () => {
    expect(await order()).toEqual(["*a", "b", "c"]);
    await withRls(admin, (sql) =>
      setPrimaryImage(sql, { profileId: orderProfileId, imageId: ids.c! }),
    );
    expect(await order()).toEqual(["*c", "a", "b"]);
  });

  it("한 칸씩 옮기고, 첫 장이 되면 대표가 된다", async () => {
    await withRls(admin, (sql) =>
      moveImage(sql, { profileId: orderProfileId, imageId: ids.b!, direction: "earlier" }),
    );
    expect(await order()).toEqual(["*c", "b", "a"]);
    await withRls(admin, (sql) =>
      moveImage(sql, { profileId: orderProfileId, imageId: ids.b!, direction: "earlier" }),
    );
    expect(await order()).toEqual(["*b", "c", "a"]);
  });

  it("끝에서 더 밀면 그대로다", async () => {
    await withRls(admin, async (sql) => {
      await moveImage(sql, { profileId: orderProfileId, imageId: ids.b!, direction: "earlier" });
      await moveImage(sql, { profileId: orderProfileId, imageId: ids.a!, direction: "later" });
    });
    expect(await order()).toEqual(["*b", "c", "a"]);
  });

  it("대표가 첫 장이 아닌 옛 데이터도 대표를 맨 앞에 세운다", async () => {
    await withOwner(async (sql) => {
      await sql.query(`UPDATE profile_images SET is_primary = false WHERE profile_id = $1`, [
        orderProfileId,
      ]);
      await sql.query(`UPDATE profile_images SET is_primary = true WHERE id = $1`, [ids.a]);
    });
    expect(await order()).toEqual(["*a", "b", "c"]);
    // 이어서 옮기면 보이던 순서 그대로 다시 매긴다.
    await withRls(admin, (sql) =>
      moveImage(sql, { profileId: orderProfileId, imageId: ids.c!, direction: "earlier" }),
    );
    expect(await order()).toEqual(["*a", "c", "b"]);
  });

  it("다른 주선자는 남의 프로필 사진 순서를 바꾸지 못한다", async () => {
    const outsider = await withOwner(async (sql) => {
      const u = await sql.query<{ id: string }>(
        `INSERT INTO users (role, email, display_name)
         VALUES ('ADMIN', $1, $2) RETURNING id`,
        [`${TAG}-out@test.local`, `${TAG}-out`],
      );
      return u.rows[0]!.id;
    });
    try {
      await expect(
        withRls({ userId: outsider, role: "ADMIN" }, (sql) =>
          moveImage(sql, { profileId: orderProfileId, imageId: ids.c!, direction: "earlier" }),
        ),
      ).rejects.toThrow();
      expect(await order()).toEqual(["*a", "c", "b"]);
    } finally {
      await withOwner((sql) => sql.query(`DELETE FROM users WHERE id = $1`, [outsider]));
    }
  });
});
