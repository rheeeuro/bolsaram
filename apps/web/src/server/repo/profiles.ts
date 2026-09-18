/**
 * 프로필 조회/수정. 모든 쿼리는 RLS 트랜잭션 안에서 실행된다.
 * 공개 범위 판정은 @bolsaram/domain 의 projectProfile 이 담당하고, 여기서는
 * 조회와 매핑만 한다.
 */
import "server-only";
import type { Sql } from "@bolsaram/db";
import {
  DomainError,
  HAS_PHOTO_SQL,
  PROFILE_ORDER_BY,
  buildDiscoverWhere,
  decodeCursor,
  encodeCursor,
  isOppositeGender,
  type FullProfile,
} from "@bolsaram/domain";
import type {
  AdminProfileQuery,
  DiscoverQuery,
  Gender,
  ProfileStatus,
  ProfileUpdate,
  Visibility,
} from "@bolsaram/schemas";

const PROFILE_COLUMNS = `
  p.id, p.user_id, p.public_code, p.gender, p.birth_year, p.height,
  p.job_title, p.job_category, p.company, p.education,
  p.residence_region, p.workplace_region, p.religion, p.mbti,
  p.smoking, p.drinking, p.hobbies, p.hashtags, p.bio, p.ideal_type_text,
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
  hashtags: string[];
  bio: string | null;
  ideal_type_text: string | null;
  real_name: string | null;
  contact_note: string | null;
  status: ProfileStatus;
  visibility: Visibility;
  created_at: Date;
  updated_at: Date;
};

/**
 * 목록 쿼리는 사진 유무를 함께 뽑는다. 커서에 실어야 다음 페이지가 같은 자리에서 이어진다.
 */
type ProfileListRow = ProfileRow & { has_photo: boolean };

const LIST_COLUMNS = `${PROFILE_COLUMNS}, ${HAS_PHOTO_SQL} AS has_photo`;

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
    hashtags: row.hashtags ?? [],
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

/**
 * 프로필의 성별. 볼 수 있는 상대를 정하는 값이라 **항상 DB 에서 읽는다.**
 * 자기 프로필은 RLS 의 본인 절로, 대행 프로필은 주선자 절로 보인다.
 */
async function genderOf(sql: Sql, profileId: string): Promise<Gender | null> {
  const result = await sql.query<{ gender: Gender }>(
    `SELECT gender FROM profiles WHERE id = $1`,
    [profileId],
  );
  return result.rows[0]?.gender ?? null;
}

/**
 * 멤버 화면에서 가려야 하는 상대인가 — 같은 성별이면 가린다.
 *
 * 목록에서 빼는 것만으로는 새어 나간다. 주소를 직접 열거나 시그널에서 넘어오는
 * 경로가 있어서, 상세를 여는 쪽에서도 같은 판정을 한다.
 */
export async function isSameGenderForViewer(
  sql: Sql,
  viewerProfileId: string,
  targetGender: string,
): Promise<boolean> {
  const mine = await genderOf(sql, viewerProfileId);
  return mine != null && !isOppositeGender(mine, targetGender as Gender);
}

/**
 * 멤버 화면에서 가려야 하는 풀 밖의 사람인가 — 다른 모임이거나 전체공개 경계를 넘으면 가린다.
 *
 * 평소에는 RLS 가 같은 경계를 긋는다. **대행 중에는 아니다** — 커넥션의 권한이
 * 주선자의 것이라 전체공개 풀과 그 주선자의 다른 모임까지 열린다. 목록에서 빼는
 * 것만으로는 주소를 직접 열 수 있으므로 상세에서도 같은 판정을 한다.
 */
export async function isOutsidePoolForViewer(
  sql: Sql,
  viewerProfileId: string,
  targetProfileId: string,
): Promise<boolean> {
  const result = await sql.query<{ outside: boolean }>(
    `SELECT (viewer.group_id IS DISTINCT FROM target.group_id) AS outside
       FROM profiles viewer, profiles target
      WHERE viewer.id = $1 AND target.id = $2`,
    [viewerProfileId, targetProfileId],
  );
  // 한쪽이라도 읽히지 않으면 보여주지 않는다.
  return result.rows[0]?.outside ?? true;
}

export type DiscoverPage = {
  items: ProfileRecord[];
  nextCursor: string | null;
  /** 필터 결과 총 개수. 필터 시트의 "N명 보기" 버튼에 쓴다. */
  total: number;
};

/**
 * 멤버 탐색 목록.
 *
 * **이성만 보여준다.** 보는 사람의 성별은 프로필에서 읽는다 — 요청으로 받으면
 * 대행 중인 주선자나 조작된 값으로 경계가 흔들린다. 대행 중이면 세션의
 * `profileId` 가 대행 프로필이므로 그 사람 기준으로 걸린다.
 */
export async function findDiscoverProfiles(
  sql: Sql,
  query: DiscoverQuery,
  viewerProfileId: string | null,
): Promise<DiscoverPage> {
  const where = buildDiscoverWhere(query, {
    viewerProfileId,
    viewerGender: viewerProfileId ? await genderOf(sql, viewerProfileId) : null,
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
    values.push(cursor.hasPhoto, cursor.createdAt, cursor.id);
    clause += ` AND (${HAS_PHOTO_SQL}, p.created_at, p.id) < ($${values.length - 2}, $${values.length - 1}, $${values.length})`;
  }
  values.push(query.limit + 1);

  const result = await sql.query<ProfileListRow>(
    `SELECT ${LIST_COLUMNS}
       FROM profiles p
      WHERE ${clause}
      ORDER BY ${PROFILE_ORDER_BY}
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
      hasMore && last
        ? encodeCursor({
            hasPhoto: last.has_photo,
            createdAt: last.created_at,
            id: last.id,
          })
        : null,
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
  hashtags: "hashtags",
  bio: "bio",
  idealTypeText: "ideal_type_text",
  realName: "real_name",
  contactNote: "contact_note",
};

/**
 * 이 프로필을 고칠 수 있는지 RLS 와 같은 기준으로 묻는다.
 *
 * 읽기와 쓰기가 다르기 때문에 필요하다 — 전체공개 프로필은 모든 주선자가 보지만
 * 고치는 것은 등록한 사람뿐이다. RLS 정책이 이미 같은 판정을 하지만, owner 커넥션을
 * 쓰는 경로(초대 발급)는 정책을 지나가므로 애플리케이션 레이어에서 한 번 더 막는다.
 *
 * 반드시 `withRls(ctx, ...)` 안에서 호출한다. owner 커넥션에서는 세션 컨텍스트가
 * 없어 의미 없는 답이 나온다.
 */
/**
 * 여러 프로필을 한 번에 물어 고칠 수 있는 것만 돌려준다.
 *
 * 목록 화면이 프로필마다 판정 함수를 부르면 행 수만큼 쿼리가 늘어난다. 주선자
 * 화면은 이 집합으로 공개 단계를 가르므로(담당이면 전부, 아니면 멤버와 같은 단계)
 * 한 번에 읽는 경로가 필요하다.
 */
export async function canEditProfiles(sql: Sql, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const result = await sql.query<{ id: string }>(
    `SELECT id FROM profiles WHERE id = ANY($1) AND app_can_edit_profile(id)`,
    [ids],
  );
  return new Set(result.rows.map((r) => r.id));
}

export async function assertCanEditProfile(sql: Sql, profileId: string): Promise<void> {
  const result = await sql.query<{ allowed: boolean }>(
    `SELECT app_can_edit_profile($1) AS allowed`,
    [profileId],
  );
  if (!result.rows[0]?.allowed) {
    throw new DomainError("FORBIDDEN", "이 프로필을 관리할 권한이 없습니다.");
  }
}

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
  /** 지금 보고 있는 채널. null 이면 전체공개 풀만 본다. */
  scope: { groupId: string | null },
): Promise<{ items: ProfileRecord[]; nextCursor: string | null; total: number }> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const push = (v: unknown) => {
    values.push(v);
    return `$${values.length}`;
  };

  // 채널 필터다. RLS 가 이미 볼 수 없는 것을 걸러내므로 여기서 좁히는 것은 권한이
  // 아니라 「지금 이 모임」이라는 화면의 약속이다. NULL 끼리도 같게 보려고
  // IS NOT DISTINCT FROM 을 쓴다(전체공개 채널).
  clauses.push(`p.group_id IS NOT DISTINCT FROM ${push(scope.groupId)}`);

  if (query.status?.length) clauses.push(`p.status = ANY(${push(query.status)})`);
  if (query.gender) clauses.push(`p.gender = ${push(query.gender)}`);
  if (query.claimed === "yes") clauses.push("p.user_id IS NOT NULL");
  if (query.claimed === "no") clauses.push("p.user_id IS NULL");
  // 태그는 여러 개를 주면 좁힌다. 멤버 탐색과 같은 규칙이다.
  if (query.tags?.length) clauses.push(`p.hashtags @> ${push(query.tags)}`);
  if (query.q) {
    // `17번` 은 공개 번호, `#여행` 은 해시태그다. 숫자인지로 가른다.
    // 적는 방식을 따지지 않는다 — `17` · `17번` · 예전 표기 `#17` 을 모두 번호로 받는다.
    const codeMatch = /^[@#]?(\d+)\s*번?$/.exec(query.q);
    const needle = query.q.replace(/^[@#]+/u, "").trim();
    const term = push(`%${needle.length > 0 ? needle : query.q}%`);
    const codeClause = codeMatch ? ` OR p.public_code = ${push(Number(codeMatch[1]))}` : "";
    clauses.push(
      `(p.real_name ILIKE ${term} OR p.job_title ILIKE ${term} OR p.company ILIKE ${term} OR array_to_string(p.hashtags, ' ') ILIKE ${term}${codeClause})`,
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
    values.push(cursor.hasPhoto, cursor.createdAt, cursor.id);
    clause += ` AND (${HAS_PHOTO_SQL}, p.created_at, p.id) < ($${values.length - 2}, $${values.length - 1}, $${values.length})`;
  }
  values.push(query.limit + 1);

  const result = await sql.query<ProfileListRow>(
    `SELECT ${LIST_COLUMNS} FROM profiles p
      WHERE ${clause}
      ORDER BY ${PROFILE_ORDER_BY}
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
      hasMore && last
        ? encodeCursor({
            hasPhoto: last.has_photo,
            createdAt: last.created_at,
            id: last.id,
          })
        : null,
  };
}
