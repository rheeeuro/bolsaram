/**
 * 프로필 사진 저장소.
 *
 * 사진은 Import 로 처음 들어오지만 그 뒤에도 바뀐다 — 대면에서 「이 사진 말고 다른
 * 걸로」가 나온다. 여기서 추가·삭제·대표 지정·순서 바꾸기를 다룬다.
 *
 * 쓰기 권한은 RLS 가 `app_can_edit_profile` 로 판정한다(0034). 이 파일은 그 위에서
 * 순서와 대표 사진의 불변식만 지킨다:
 *   - 대표 사진은 프로필당 최대 하나 (`profile_images_one_primary`)
 *   - 사진이 하나라도 있으면 대표가 하나 있어야 한다
 *   - 대표가 첫 장이다. 읽을 때도 대표를 맨 앞에 세우고(`IMAGE_ORDER`), 순서를 바꾸면
 *     첫 장을 대표로 맞춘다
 *   - `sort_order` 는 프로필 안에서 유일 (`UNIQUE (profile_id, sort_order)`)
 *   - 한 프로필에 `PROFILE_IMAGE_MAX_COUNT` 장까지 (DB 트리거가 최종 판정, 0054)
 */
import "server-only";
import type { Sql } from "@bolsaram/db";
import { DomainError } from "@bolsaram/domain";
import { PROFILE_IMAGE_MAX_COUNT } from "@bolsaram/schemas";

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

/** 화면에 보이는 순서. 대표가 맨 앞이고 나머지는 저장된 순서다. */
export const IMAGE_ORDER = `is_primary DESC, sort_order`;

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

/**
 * 이 저장 키가 지금 볼 수 있는 프로필의 사진이면 그 프로필 id. 판정은 RLS(`profile_images_read`)가 한다.
 *
 * Import 로 들어온 사진은 원본 키(`import/…`)를 그대로 프로필 사진으로 쓴다. 그 영역은
 * 주선자 전용이지만, 프로필에 붙어 멤버에게 보이는 사진이면 멤버도 열어야 한다.
 * 자기 사진인지(워터마크를 뺄지)도 이 값으로 가린다.
 */
export async function findImageProfileId(sql: Sql, storageKey: string): Promise<string | null> {
  const result = await sql.query<{ profile_id: string }>(
    `SELECT profile_id FROM profile_images WHERE storage_key = $1 LIMIT 1`,
    [storageKey],
  );
  return result.rows[0]?.profile_id ?? null;
}

export async function listImages(sql: Sql, profileId: string): Promise<ProfileImageRecord[]> {
  const result = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM profile_images WHERE profile_id = $1 ORDER BY ${IMAGE_ORDER}`,
    [profileId],
  );
  return result.rows.map(toRecord);
}

/** 지금 몇 장인가. 상한이 남았는지 보는 곳들이 쓴다. */
export async function countImages(sql: Sql, profileId: string): Promise<number> {
  const result = await sql.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM profile_images WHERE profile_id = $1`,
    [profileId],
  );
  return result.rows[0]?.count ?? 0;
}

/**
 * 맨 뒤에 한 장 붙인다. 첫 장이면 대표가 된다 — 사진이 있는데 대표가 없는 상태를
 * 만들지 않는다.
 *
 * `sort_order` 는 최댓값 + 1 이다. 삭제로 생긴 구멍은 메우지 않는다 — 번호를 다시
 * 매기면 남은 사진의 순서가 흔들린다.
 *
 * 상한을 여기서 먼저 본다. 넘으면 트리거(0054)가 어차피 막지만 그쪽은 DB 오류라
 * 사용자에게 보여줄 말이 못 된다 — 같은 판정을 사람이 읽을 문장으로 돌려준다.
 */
export async function addImage(
  sql: Sql,
  input: { profileId: string; storageKey: string; mimeType: string; byteSize: number },
): Promise<ProfileImageRecord> {
  if ((await countImages(sql, input.profileId)) >= PROFILE_IMAGE_MAX_COUNT) {
    throw new DomainError(
      "VALIDATION",
      `사진은 최대 ${PROFILE_IMAGE_MAX_COUNT}장까지 올릴 수 있습니다. 먼저 한 장을 지워주세요.`,
    );
  }
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
 * 이 사진을 대표로 — 맨 앞으로 옮긴다. 대표와 첫 장이 어긋나면 목록 카드와 상세의
 * 첫 사진이 달라진다.
 */
export async function setPrimaryImage(
  sql: Sql,
  input: { profileId: string; imageId: string },
): Promise<void> {
  const ids = await orderedIds(sql, input.profileId, input.imageId);
  await writeOrder(sql, input.profileId, [input.imageId, ...ids.filter((id) => id !== input.imageId)]);
}

/**
 * 한 칸 앞이나 뒤로 옮긴다. 카카오톡에서 텔레그램으로 공유하면 순서가 바뀌어 오는데
 * 서버는 원래 순서를 알 수 없다 — 주선자가 화면에서 맞춘다.
 * 첫 장이 되면 대표가 된다. 끝에서 더 밀면 그대로 둔다.
 */
export async function moveImage(
  sql: Sql,
  input: { profileId: string; imageId: string; direction: "earlier" | "later" },
): Promise<void> {
  const ids = await orderedIds(sql, input.profileId, input.imageId);
  const from = ids.indexOf(input.imageId);
  const to = input.direction === "earlier" ? from - 1 : from + 1;
  if (to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to]!, ids[from]!];
  await writeOrder(sql, input.profileId, ids);
}

/** 지금 화면 순서의 id 목록. 대상 사진이 이 프로필에 없으면 막는다. */
async function orderedIds(sql: Sql, profileId: string, imageId: string): Promise<string[]> {
  const result = await sql.query<{ id: string }>(
    `SELECT id FROM profile_images WHERE profile_id = $1 ORDER BY ${IMAGE_ORDER}`,
    [profileId],
  );
  const ids = result.rows.map((r) => r.id);
  if (!ids.includes(imageId)) throw new DomainError("NOT_FOUND", "사진을 찾을 수 없습니다.");
  return ids;
}

/**
 * 순서를 0 부터 다시 매기고 첫 장을 대표로 한다.
 *
 * `(profile_id, sort_order)` UNIQUE 는 행마다 바로 검사되므로 먼저 전부 음수 자리로
 * 비켜 둔다. 대표도 부분 유니크 인덱스가 있어 **먼저 내리고 올린다**.
 */
async function writeOrder(sql: Sql, profileId: string, ids: string[]): Promise<void> {
  const moved = await sql.query(
    `UPDATE profile_images SET sort_order = -1 - sort_order WHERE profile_id = $1`,
    [profileId],
  );
  // RLS 가 막으면 0행이다. 조용히 성공으로 넘기지 않는다.
  if (moved.rowCount !== ids.length) {
    throw new DomainError("FORBIDDEN", "이 프로필의 사진을 다룰 권한이 없습니다.");
  }
  await sql.query(
    `UPDATE profile_images p SET sort_order = o.position - 1
       FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, position)
      WHERE p.profile_id = $1 AND p.id = o.id`,
    [profileId, ids],
  );
  await sql.query(
    `UPDATE profile_images SET is_primary = false
      WHERE profile_id = $1 AND is_primary AND id <> $2`,
    [profileId, ids[0]],
  );
  await sql.query(`UPDATE profile_images SET is_primary = true WHERE id = $1 AND profile_id = $2`, [
    ids[0],
    profileId,
  ]);
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
