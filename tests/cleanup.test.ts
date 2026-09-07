/**
 * 만료 데이터 정리 통합 테스트.
 *
 * 가장 중요한 성질은 **참조된 사진을 지우지 않는 것**이다. commit 된 Import 는 에셋을
 * 복사하지 않고 같은 storage_key 를 프로필 사진으로 연결하므로, 세션만 보고 파일을 지우면
 * 게시된 프로필 사진이 조용히 깨진다.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withOwner, type Sql } from "@bolsaram/db";
import { purgeAbandonedImports, runCleanup } from "../packages/db/src/cleanup";

const TAG = `cleanuptest-${Date.now()}`;
const STORAGE = path.resolve(import.meta.dirname, "..", "var", "test-storage", TAG);

let adminId: string;
let groupId: string;

async function seedFile(key: string): Promise<void> {
  const full = path.join(STORAGE, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, "테스트 파일");
}

/** updated_at 을 과거로 돌린다. set_updated_at 트리거가 되돌리므로 잠시 끈다. */
async function ageSession(sql: Sql, id: string, days: number): Promise<void> {
  await sql.query(`ALTER TABLE import_sessions DISABLE TRIGGER import_sessions_set_updated_at`);
  await sql.query(
    `UPDATE import_sessions SET updated_at = now() - make_interval(days => $2) WHERE id = $1`,
    [id, days],
  );
  await sql.query(`ALTER TABLE import_sessions ENABLE TRIGGER import_sessions_set_updated_at`);
}

async function newSession(sql: Sql): Promise<string> {
  const r = await sql.query<{ id: string }>(
    `INSERT INTO import_sessions (group_id, created_by, source, raw_text)
     VALUES ($1,$2,'TEXT',$3) RETURNING id`,
    [groupId, adminId, TAG],
  );
  return r.rows[0]!.id;
}

async function addAsset(sql: Sql, sessionId: string, key: string, order = 0): Promise<void> {
  await sql.query(
    `INSERT INTO import_assets
       (import_session_id, storage_key, mime_type, byte_size, sort_order, uploaded_at)
     VALUES ($1,$2,'image/png',10,$3, now())`,
    [sessionId, key, order],
  );
}

beforeAll(async () => {
  const fixture = await withOwner(async (sql) => {
    const g = await sql.query<{ id: string }>(
      `INSERT INTO groups (name) VALUES ($1) RETURNING id`,
      [TAG],
    );
    const r = await sql.query<{ id: string }>(
      `INSERT INTO users (role, email, password_hash, display_name)
       VALUES ('ADMIN',$1,'x',$2) RETURNING id`,
      [`${TAG}@test.local`, TAG],
    );
    return { group: g.rows[0]!.id, userId: r.rows[0]!.id };
  });
  groupId = fixture.group;
  adminId = fixture.userId;
});

afterAll(async () => {
  await withOwner(async (sql) => {
    await sql.query(`DELETE FROM import_sessions WHERE created_by = $1`, [adminId]);
    await sql.query(`DELETE FROM profiles WHERE created_by = $1`, [adminId]);
    await sql.query(`DELETE FROM users WHERE id = $1`, [adminId]);
    await sql.query(`DELETE FROM login_codes WHERE phone LIKE '0109888%'`);
    await sql.query(`DELETE FROM groups WHERE name = $1`, [TAG]);
  });
  await rm(STORAGE, { recursive: true, force: true });
  await closePools();
});

describe("purgeAbandonedImports", () => {
  it("프로필이 참조하는 사진은 세션을 지워도 남긴다", async () => {
    await withOwner(async (sql) => {
      const sessionId = await newSession(sql);
      const sharedKey = `import/${sessionId}/shared.png`;
      const orphanKey = `import/${sessionId}/orphan.png`;
      await seedFile(sharedKey);
      await seedFile(orphanKey);
      await addAsset(sql, sessionId, sharedKey, 0);
      await addAsset(sql, sessionId, orphanKey, 1);

      // 한 장만 프로필 사진으로 연결한다(= commit 된 것처럼).
      const profile = await sql.query<{ id: string }>(
        `INSERT INTO profiles (group_id, gender, birth_year, residence_region, created_by)
         VALUES ($1,'FEMALE',1993,'SEOUL',$2) RETURNING id`,
        [groupId, adminId],
      );
      await sql.query(
        `INSERT INTO profile_images (profile_id, storage_key, mime_type, byte_size, sort_order, is_primary)
         VALUES ($1,$2,'image/png',10,0,true)`,
        [profile.rows[0]!.id, sharedKey],
      );

      await ageSession(sql, sessionId, 60);
      const result = await purgeAbandonedImports(sql, STORAGE);

      expect(result.sessions).toBe(1);
      expect(result.files).toBe(1); // orphan 만 삭제
      expect(result.skipped).toBe(1); // shared 는 보존
      expect(existsSync(path.join(STORAGE, sharedKey))).toBe(true);
      expect(existsSync(path.join(STORAGE, orphanKey))).toBe(false);
    });
  });

  it("최근 세션은 건드리지 않는다", async () => {
    await withOwner(async (sql) => {
      const sessionId = await newSession(sql);
      const key = `import/${sessionId}/recent.png`;
      await seedFile(key);
      await addAsset(sql, sessionId, key);

      const result = await purgeAbandonedImports(sql, STORAGE);
      expect(result.sessions).toBe(0);
      expect(existsSync(path.join(STORAGE, key))).toBe(true);

      const still = await sql.query(`SELECT 1 FROM import_sessions WHERE id = $1`, [sessionId]);
      expect(still.rowCount).toBe(1);
    });
  });

  it("등록이 끝난(IMPORTED) 세션은 오래돼도 지우지 않는다", async () => {
    await withOwner(async (sql) => {
      const profile = await sql.query<{ id: string }>(
        `INSERT INTO profiles (group_id, gender, birth_year, residence_region, created_by)
         VALUES ($1,'MALE',1990,'BUSAN',$2) RETURNING id`,
        [groupId, adminId],
      );
      const sessionId = await newSession(sql);
      await sql.query(
        `UPDATE import_sessions
            SET status='IMPORTED', committed_profile_id=$2, committed_at=now()
          WHERE id=$1`,
        [sessionId, profile.rows[0]!.id],
      );
      await ageSession(sql, sessionId, 120);

      const result = await purgeAbandonedImports(sql, STORAGE);
      expect(result.sessions).toBe(0);
      const still = await sql.query(`SELECT 1 FROM import_sessions WHERE id = $1`, [sessionId]);
      expect(still.rowCount).toBe(1);
    });
  });

  it("저장소 밖을 가리키는 키는 지우지 않는다", async () => {
    await withOwner(async (sql) => {
      const sessionId = await newSession(sql);
      // 경로 탈출 시도. DB 값이라도 그대로 믿지 않는다.
      await addAsset(sql, sessionId, "../../../etc/passwd");
      await ageSession(sql, sessionId, 60);

      const result = await purgeAbandonedImports(sql, STORAGE);
      expect(result.files).toBe(0);
      expect(existsSync("/etc/passwd")).toBe(true);
    });
  });
});

describe("runCleanup", () => {
  it("만료된 로그인 코드를 지운다", async () => {
    await withOwner(async (sql) => {
      await sql.query(
        `INSERT INTO login_codes (phone, code_hash, expires_at, created_at)
         SELECT '0109888'||g, 'x', now()-interval '10 days', now()-interval '10 days'
           FROM generate_series(1,3) g`,
      );
      const summary = await runCleanup(sql, STORAGE);
      const step = summary.find((s) => s.label === "만료 로그인 코드");
      expect(step?.count).toBeGreaterThanOrEqual(3);

      const left = await sql.query(`SELECT 1 FROM login_codes WHERE phone LIKE '0109888%'`);
      expect(left.rowCount).toBe(0);
    });
  });

  it("기한이 지나 열려 있는 초대를 회수한다", async () => {
    await withOwner(async (sql) => {
      const profile = await sql.query<{ id: string }>(
        `INSERT INTO profiles (group_id, gender, birth_year, residence_region, created_by)
         VALUES ($1,'FEMALE',1995,'JEJU',$2) RETURNING id`,
        [groupId, adminId],
      );
      const profileId = profile.rows[0]!.id;
      await sql.query(
        `INSERT INTO invites (profile_id, token_hash, expires_at)
         VALUES ($1, $2, now() - interval '1 day')`,
        [profileId, `${TAG}-hash`],
      );

      await runCleanup(sql, STORAGE);
      const row = await sql.query<{ revoked_at: Date | null }>(
        `SELECT revoked_at FROM invites WHERE profile_id = $1`,
        [profileId],
      );
      expect(row.rows[0]?.revoked_at).not.toBeNull();
    });
  });

  it("여러 번 돌려도 안전하다 (두 번째는 처리할 게 없다)", async () => {
    await withOwner(async (sql) => {
      await runCleanup(sql, STORAGE);
      const second = await runCleanup(sql, STORAGE);
      expect(second).toEqual([]);
    });
  });
});
