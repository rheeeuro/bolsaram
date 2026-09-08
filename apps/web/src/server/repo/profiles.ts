/**
 * 프로필 조회/수정. 모든 쿼리는 RLS 트랜잭션 안에서 실행된다.
 * 공개 범위 판정은 @bolsaram/domain 의 projectProfile 이 담당하고, 여기서는
 * 조회와 매핑만 한다.
 */
import "server-only";
import type { Sql } from "@bolsaram/db";
import {
  buildDiscoverWhere,
  decodeCursor,
  encodeCursor,
  type FullProfile,
} from "@bolsaram/domain";
import type {
  AdminProfileQuery,
  DiscoverQuery,
  ProfileStatus,
  ProfileUpdate,
  Visibility,
} from "@bolsaram/schemas";

const PROFILE_COLUMNS = `
  p.id, p.user_id, p.public_code, p.gender, p.birth_year, p.height,
  p.job_title, p.job_category, p.company, p.education,
  p.residence_region, p.workplace_region, p.religion, p.mbti,
  p.smoking, p.drinking, p.hobbies, p.bio, p.ideal_type_text,
  p.real_name, p.contact_note, p.status, p.visibility,
  p.created_at, p.updated_at`;

type ProfileRow = {
  id: string;
  user_id: string | null;
  public_code: number;
  gender: string;
  birth_year: number;
  height: number | null;
  job_title: string | null;
  job_category: string | null;
  company: string | null;
  education: string | null;
  residence_region: string;
  workplace_region: string | null;
  religion: string | null;
  mbti: string | null;
  smoking: string | null;
  drinking: string | null;
  hobbies: string[];
  bio: string | null;
  ideal_type_text: string | null;
  real_name: string | null;
  contact_note: string | null;
  status: ProfileStatus;
  visibility: Visibility;
  created_at: Date;
  updated_at: Date;
};

export type ProfileRecord = FullProfile & {
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ImageRow = {
  id: string;
  profile_id: string;
  storage_key: string;
  sort_order: number;
  is_primary: boolean;
};

function toRecord(row: ProfileRow, images: FullProfile["images"]): ProfileRecord {
  return {
    id: row.id,
    userId: row.user_id,
    publicCode: row.public_code,
    gender: row.gender,
    birthYear: row.birth_year,
    height: row.height,
    jobTitle: row.job_title,
    jobCategory: row.job_category,
    company: row.company,
    education: row.education,
    residenceRegion: row.residence_region,
    workplaceRegion: row.workplace_region,
    religion: row.religion,
    mbti: row.mbti,
    smoking: row.smoking,
    drinking: row.drinking,
    hobbies: row.hobbies ?? [],
    bio: row.bio,
    idealTypeText: row.ideal_type_text,
    realName: row.real_name,
    contactNote: row.contact_note,
    status: row.status,
    visibility: row.visibility,
    images,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function imagesFor(
  sql: Sql,
  profileIds: string[],
): Promise<Map<string, FullProfile["images"]>> {
  const map = new Map<string, FullProfile["images"]>();
  if (profileIds.length === 0) return map;
  const result = await sql.query<ImageRow>(
    `SELECT id, profile_id, storage_key, sort_order, is_primary
       FROM profile_images
      WHERE profile_id = ANY($1)
      ORDER BY profile_id, sort_order`,
    [profileIds],
  );
  for (const row of result.rows) {
    const list = map.get(row.profile_id) ?? [];
    list.push({
      id: row.id,
      storageKey: row.storage_key,
      sortOrder: row.sort_order,
      isPrimary: row.is_primary,
    });
    map.set(row.profile_id, list);
  }
  return map;
}

export type DiscoverPage = {
  items: ProfileRecord[];
  nextCursor: string | null;
  /** 필터 결과 총 개수. 필터 시트의 "N명 보기" 버튼에 쓴다. */
  total: number;
};

export async function findDiscoverProfiles(
  sql: Sql,
  query: DiscoverQuery,
  viewerProfileId: string | null,
): Promise<DiscoverPage> {
  const where = buildDiscoverWhere(query, {
    viewerProfileId,
    currentYear: new Date().getFullYear(),
  });

  const countResult = await sql.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM profiles p WHERE ${where.text}`,
    where.values,
  );
  const total = countResult.rows[0]?.total ?? 0;

  const values = [...where.values];
  let clause = where.text;
  const cursor = decodeCursor(query.cursor);
  if (cursor) {
    values.push(cursor.createdAt, cursor.id);
    clause += ` AND (p.created_at, p.id) < ($${values.length - 1}, $${values.length})`;
  }
  values.push(query.limit + 1);

  const result = await sql.query<ProfileRow>(
    `SELECT ${PROFILE_COLUMNS}
       FROM profiles p
      WHERE ${clause}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $${values.length}`,
    values,
  );

  const hasMore = result.rows.length > query.limit;
  const rows = hasMore ? result.rows.slice(0, query.limit) : result.rows;
  const images = await imagesFor(
    sql,
    rows.map((r) => r.id),
  );
  const items = rows.map((r) => toRecord(r, images.get(r.id) ?? []));
  const last = rows.at(-1);

  return {
    items,
    total,
    nextCursor:
      hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
  };
}

export async function findProfileById(sql: Sql, id: string): Promise<ProfileRecord | null> {
  const result = await sql.query<ProfileRow>(
    `SELECT ${PROFILE_COLUMNS} FROM profiles p WHERE p.id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  const images = await imagesFor(sql, [row.id]);
  return toRecord(row, images.get(row.id) ?? []);
}

export async function findProfilesByIds(sql: Sql, ids: string[]): Promise<ProfileRecord[]> {
  if (ids.length === 0) return [];
  const result = await sql.query<ProfileRow>(
    `SELECT ${PROFILE_COLUMNS} FROM profiles p WHERE p.id = ANY($1)`,
    [ids],
  );
  const images = await imagesFor(
    sql,
    result.rows.map((r) => r.id),
  );
  return result.rows.map((r) => toRecord(r, images.get(r.id) ?? []));
}

// ── 쓰기 ──────────────────────────────────────────────────────

/** camelCase 필드명 → DB 컬럼명. 여기 없는 키는 업데이트 대상이 아니다. */
const UPDATABLE_COLUMNS: Record<keyof ProfileUpdate, string> = {
  gender: "gender",
  birthYear: "birth_year",
  height: "height",
  jobTitle: "job_title",
  jobCategory: "job_category",
  company: "company",
  education: "education",
  residenceRegion: "residence_region",
  workplaceRegion: "workplace_region",
  religion: "religion",
  mbti: "mbti",
  smoking: "smoking",
  drinking: "drinking",
  hobbies: "hobbies",
  bio: "bio",
  idealTypeText: "ideal_type_text",
  realName: "real_name",
  contactNote: "contact_note",
};

export async function updateProfile(
  sql: Sql,
  id: string,
  patch: ProfileUpdate,
): Promise<boolean> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
    if (!(key in patch)) continue;
    values.push(patch[key as keyof ProfileUpdate]);
    sets.push(`${column} = $${values.length}`);
  }
  if (sets.length === 0) return false;
  values.push(id);
  const result = await sql.query(
    `UPDATE profiles SET ${sets.join(", ")} WHERE id = $${values.length}`,
    values,
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateProfileStatus(
  sql: Sql,
  id: string,
  status: ProfileStatus,
  visibility?: Visibility,
): Promise<boolean> {
  const result = visibility
    ? await sql.query(`UPDATE profiles SET status = $2, visibility = $3 WHERE id = $1`, [
        id,
        status,
        visibility,
      ])
    : await sql.query(`UPDATE profiles SET status = $2 WHERE id = $1`, [id, status]);
  return (result.rowCount ?? 0) > 0;
}

// ── 관리자 목록 ───────────────────────────────────────────────

export async function findAdminProfiles(
  sql: Sql,
  query: AdminProfileQuery,
): Promise<{ items: ProfileRecord[]; nextCursor: string | null; total: number }> {
  const clauses: string[] = ["TRUE"];
  const values: unknown[] = [];
  const push = (v: unknown) => {
    values.push(v);
    return `$${values.length}`;
  };

  if (query.status?.length) clauses.push(`p.status = ANY(${push(query.status)})`);
  if (query.gender) clauses.push(`p.gender = ${push(query.gender)}`);
  if (query.claimed === "yes") clauses.push("p.user_id IS NOT NULL");
  if (query.claimed === "no") clauses.push("p.user_id IS NULL");
  if (query.q) {
    const term = push(`%${query.q}%`);
    const codeMatch = /^#?(\d+)$/.exec(query.q);
    const codeClause = codeMatch ? ` OR p.public_code = ${push(Number(codeMatch[1]))}` : "";
    clauses.push(
      `(p.real_name ILIKE ${term} OR p.job_title ILIKE ${term} OR p.company ILIKE ${term}${codeClause})`,
    );
  }

  const where = clauses.join(" AND ");
  const countResult = await sql.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM profiles p WHERE ${where}`,
    values,
  );

  let clause = where;
  const cursor = decodeCursor(query.cursor);
  if (cursor) {
    values.push(cursor.createdAt, cursor.id);
    clause += ` AND (p.created_at, p.id) < ($${values.length - 1}, $${values.length})`;
  }
  values.push(query.limit + 1);

  const result = await sql.query<ProfileRow>(
    `SELECT ${PROFILE_COLUMNS} FROM profiles p
      WHERE ${clause}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $${values.length}`,
    values,
  );

  const hasMore = result.rows.length > query.limit;
  const rows = hasMore ? result.rows.slice(0, query.limit) : result.rows;
  const images = await imagesFor(
    sql,
    rows.map((r) => r.id),
  );
  const last = rows.at(-1);

  return {
    items: rows.map((r) => toRecord(r, images.get(r.id) ?? [])),
    total: countResult.rows[0]?.total ?? 0,
    nextCursor:
      hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
  };
}
