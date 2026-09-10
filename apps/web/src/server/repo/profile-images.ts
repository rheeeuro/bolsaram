/**
 * 프로필 사진 저장소.
 *
 * 사진은 Import 로 처음 들어오지만 그 뒤에도 바뀐다 — 대면에서 「이 사진 말고 다른
 * 걸로」가 나온다. 여기서 추가·삭제·대표 지정을 다룬다.
 *
 * 쓰기 권한은 RLS 가 `app_can_edit_profile` 로 판정한다(0034). 이 파일은 그 위에서
 * 순서와 대표 사진의 불변식만 지킨다:
 *   - 대표 사진은 프로필당 최대 하나 (`profile_images_one_primary`)
 *   - 사진이 하나라도 있으면 대표가 하나 있어야 한다
 *   - `sort_order` 는 프로필 안에서 유일 (`UNIQUE (profile_id, sort_order)`)
 */
import "server-only";
import type { Sql } from "@bolsaram/db";
import { DomainError } from "@bolsaram/domain";

export type ProfileImageRecord = {
  id: string;
  profileId: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  sortOrder: number;
  isPrimary: boolean;
};

type Row = {
  id: string;
  profile_id: string;
  storage_key: string;
  mime_type: string;
  byte_size: number;
  sort_order: number;
  is_primary: boolean;
};

const COLUMNS = `id, profile_id, storage_key, mime_type, byte_size, sort_order, is_primary`;

function toRecord(row: Row): ProfileImageRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    sortOrder: row.sort_order,
    isPrimary: row.is_primary,
  };
}

export async function listImages(sql: Sql, profileId: string): Promise<ProfileImageRecord[]> {
  const result = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM profile_images WHERE profile_id = $1 ORDER BY sort_order`,
    [profileId],
  );
  return result.rows.map(toRecord);
}

/**
 * 맨 뒤에 한 장 붙인다. 첫 장이면 대표가 된다 — 사진이 있는데 대표가 없는 상태를
 * 만들지 않는다.
 *
 * `sort_order` 는 최댓값 + 1 이다. 삭제로 생긴 구멍은 메우지 않는다 — 번호를 다시
 * 매기면 남은 사진의 순서가 흔들린다.
 */
export async function addImage(
  sql: Sql,
  input: { profileId: string; storageKey: string; mimeType: string; byteSize: number },
): Promise<ProfileImageRecord> {
  const result = await sql.query<Row>(
    `INSERT INTO profile_images
       (profile_id, storage_key, mime_type, byte_size, sort_order, is_primary)
     SELECT $1, $2, $3, $4,
            coalesce(max(sort_order), -1) + 1,
            NOT EXISTS (SELECT 1 FROM profile_images WHERE profile_id = $1 AND is_primary)
       FROM profile_images WHERE profile_id = $1
     RETURNING ${COLUMNS}`,
    [input.profileId, input.storageKey, input.mimeType, input.byteSize],
  );
  const row = result.rows[0];
  // RLS 가 막으면 0행이다. 조용히 성공으로 넘기지 않는다.
  if (!row) throw new DomainError("FORBIDDEN", "이 프로필의 사진을 다룰 권한이 없습니다.");
  return toRecord(row);
}

/**
 * 대표 사진을 옮긴다. 부분 유니크 인덱스가 있으므로 **먼저 내리고 올린다** —
 * 순서를 바꾸면 같은 트랜잭션 안에서 대표가 둘이 되는 순간이 생겨 인덱스가 막는다.
 */
export async function setPrimaryImage(
  sql: Sql,
  input: { profileId: string; imageId: string },
): Promise<void> {
  const target = await sql.query(
    `SELECT 1 FROM profile_images WHERE id = $1 AND profile_id = $2`,
    [input.imageId, input.profileId],
  );
  if (target.rowCount === 0) throw new DomainError("NOT_FOUND", "사진을 찾을 수 없습니다.");

  await sql.query(
    `UPDATE profile_images SET is_primary = false
      WHERE profile_id = $1 AND is_primary AND id <> $2`,
    [input.profileId, input.imageId],
  );
  const updated = await sql.query(
    `UPDATE profile_images SET is_primary = true WHERE id = $1 AND profile_id = $2`,
    [input.imageId, input.profileId],
  );
  if (updated.rowCount === 0) {
    throw new DomainError("FORBIDDEN", "이 프로필의 사진을 다룰 권한이 없습니다.");
  }
}

/**
 * 한 장 지운다. 지운 사진의 storage key 를 돌려주므로 호출부가 실제 파일도 지운다.
 *
 * 대표를 지웠으면 남은 것 중 첫 장을 대표로 올린다 — 사진이 있는데 대표가 없는
 * 상태를 남기지 않는다.
 */
export async function deleteImage(
  sql: Sql,
  input: { profileId: string; imageId: string },
): Promise<{ storageKey: string }> {
  const result = await sql.query<{ storage_key: string; is_primary: boolean }>(
    `DELETE FROM profile_images WHERE id = $1 AND profile_id = $2
      RETURNING storage_key, is_primary`,
    [input.imageId, input.profileId],
  );
  const row = result.rows[0];
  if (!row) throw new DomainError("NOT_FOUND", "사진을 찾을 수 없습니다.");

  if (row.is_primary) {
    await sql.query(
      `UPDATE profile_images SET is_primary = true
        WHERE id = (SELECT id FROM profile_images WHERE profile_id = $1
                     ORDER BY sort_order LIMIT 1)`,
      [input.profileId],
    );
  }
  return { storageKey: row.storage_key };
}
