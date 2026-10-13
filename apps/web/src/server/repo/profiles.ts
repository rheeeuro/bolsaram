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
  PROFILE_BUMP_COOLDOWN_HOURS,
  PROFILE_LISTED_AT_SQL,
  PROFILE_ORDER_BY,
  assertBumpable,
  buildAttributeClauses,
  buildDiscoverWhere,
  decodeCursor,
  encodeCursor,
  isOppositeGender,
  profileCursorClause,
  type FullProfile,
} from "@bolsaram/domain";
import type {
  AdminProfileQuery,
  DiscoverQuery,
  Gender,
  ProfileStatus,
  ProfileUpdate,
} from "@bolsaram/schemas";

const PROFILE_COLUMNS = `
  p.id, p.user_id, p.public_code, p.gender, p.birth_year, p.height,
  p.job_title, p.job_category, p.company, p.education,
  p.residence_region, p.workplace_region, p.religion, p.mbti,
  p.smoking, p.drinking, p.hobbies, p.hashtags, p.bio, p.ideal_type_text,
  p.host_comment, p.real_name, p.contact_note, p.status,
  p.bumped_at, p.created_at, p.updated_at`;

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
  host_comment: string | null;
  real_name: string | null;
  contact_note: string | null;
  status: ProfileStatus;
  bumped_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/**
 * 목록 쿼리는 정렬 키(사진 유무·올라온 시각)를 함께 뽑는다. 커서에 실어야 다음 페이지가
 * 같은 자리에서 이어진다.
 */
type ProfileListRow = ProfileRow & { has_photo: boolean; listed_at: Date };

const LIST_COLUMNS = `${PROFILE_COLUMNS}, ${HAS_PHOTO_SQL} AS has_photo, ${PROFILE_LISTED_AT_SQL} AS listed_at`;

export type ProfileRecord = FullProfile & {
  userId: string | null;
  /** 마지막으로 끌어올린 시각. 한 번도 안 했으면 null. */
  bumpedAt: Date | null;
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
    hostComment: row.host_comment,
    realName: row.real_name,
    contactNote: row.contact_note,
    status: row.status,
    images,
    bumpedAt: row.bumped_at,
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
    values.push(cursor.hasPhoto, cursor.listedAt, cursor.id);
    clause += ` AND ${profileCursorClause(`$${values.length - 2}`, `$${values.length - 1}`, `$${values.length}`)}`;
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
            listedAt: last.listed_at,
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

/** 공개 번호 하나만. 사진 워터마크처럼 사람을 번호로만 가리키는 곳이 쓴다. */
export async function findPublicCode(sql: Sql, id: string): Promise<number | null> {
  const result = await sql.query<{ public_code: number }>(
    `SELECT public_code FROM profiles WHERE id = $1`,
    [id],
  );
  return result.rows[0]?.public_code ?? null;
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
  hostComment: "host_comment",
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
): Promise<boolean> {
  const result = await sql.query(`UPDATE profiles SET status = $2 WHERE id = $1`, [id, status]);
  return (result.rowCount ?? 0) > 0;
}

// ── 끌어올리기 ────────────────────────────────────────────────

/**
 * 목록 맨 앞으로 다시 올린다 — 등록한 주선자만(0062).
 *
 * 판정은 도메인이 하고 DB 에는 같은 조건의 조건부 UPDATE 로 적용한다. 두 번 연달아
 * 눌러도 뒤의 것은 0건이 되어 채팅방에 알림이 한 줄만 남는다. 모임 프로필이면
 * 트리거가 그 방에 시스템 메시지를 남긴다.
 *
 * 반드시 `assertCanEditProfile` 을 먼저 부른다. 남의 프로필은 RLS 가 0건으로 만들어
 * 이유 없이 실패한다.
 */
export async function bumpProfile(sql: Sql, profileId: string): Promise<Date> {
  const found = await sql.query<{ status: ProfileStatus; bumped_at: Date | null; now: Date }>(
    `SELECT status, bumped_at, now() AS now FROM profiles WHERE id = $1`,
    [profileId],
  );
  const current = found.rows[0];
  if (!current) throw new DomainError("NOT_FOUND", "프로필을 찾을 수 없습니다.");
  // 시각은 DB 의 것을 쓴다 — 트리거가 같은 시계로 다시 판정한다.
  assertBumpable({ status: current.status, bumpedAt: current.bumped_at }, current.now);

  const result = await sql.query<{ bumped_at: Date }>(
    `UPDATE profiles SET bumped_at = now()
      WHERE id = $1
        AND status = 'ACTIVE'
        AND (bumped_at IS NULL OR bumped_at <= now() - make_interval(hours => $2))
      RETURNING bumped_at`,
    [profileId, PROFILE_BUMP_COOLDOWN_HOURS],
  );
  const row = result.rows[0];
  if (!row) {
    throw new DomainError("CONFLICT", "방금 다른 곳에서 끌어올렸습니다. 새로고침해 주세요.");
  }
  return row.bumped_at;
}

// ── 삭제 ──────────────────────────────────────────────────────

export type DeletedProfile = {
  /** 지워야 할 저장소 파일. 행이 사라진 뒤 호출하는 쪽이 지운다. */
  storageKeys: string[];
  memberDeleted: boolean;
};

/**
 * 프로필과 그 사람에 관한 것을 한 번에 지운다 — 처리방침의 「내리고 싶다」.
 *
 * 순서가 정해져 있다.
 * 1. 가져오기 세션(원문·사진·추출). 프로필보다 먼저다 — `committed_profile_id` 가
 *    SET NULL 로 풀리면 `import_sessions_commit_pair` 에 걸려 삭제가 실패한다.
 * 2. 연결된 멤버 계정. 정책(0061)이 「내가 고칠 수 있는 프로필에 연결된 계정」으로
 *    판정하므로 프로필이 남아 있을 때 지워야 한다. 세션도 함께 끊긴다.
 * 3. 프로필. 사진·신청·관심·숨김·초대·메모는 FK CASCADE 로 따라간다.
 *
 * 어느 단계든 0건이면 조용히 넘어가지 않고 실패한다. 계정만 남거나 원문만 남으면
 * 지웠다고 말한 것과 실제가 어긋난다.
 */
export async function deleteProfile(sql: Sql, profileId: string): Promise<DeletedProfile> {
  const found = await sql.query<{ user_id: string | null }>(
    `SELECT user_id FROM profiles WHERE id = $1`,
    [profileId],
  );
  const profile = found.rows[0];
  if (!profile) throw new DomainError("NOT_FOUND", "프로필을 찾을 수 없습니다.");

  // 가져오기 사진과 프로필 사진은 같은 키를 가리키는 경우가 많아 한 번만 센다.
  const keys = await sql.query<{ storage_key: string }>(
    `SELECT storage_key FROM profile_images WHERE profile_id = $1
     UNION
     SELECT a.storage_key FROM import_assets a
       JOIN import_sessions s ON s.id = a.import_session_id
      WHERE s.committed_profile_id = $1`,
    [profileId],
  );

  const sessions = await sql.query<{ id: string }>(
    `SELECT id FROM import_sessions WHERE committed_profile_id = $1`,
    [profileId],
  );
  if (sessions.rows.length > 0) {
    const removed = await sql.query(`DELETE FROM import_sessions WHERE id = ANY($1)`, [
      sessions.rows.map((r) => r.id),
    ]);
    if ((removed.rowCount ?? 0) !== sessions.rows.length) {
      throw new DomainError("FORBIDDEN", "가져오기 원본을 지울 권한이 없습니다.");
    }
  }

  let memberDeleted = false;
  if (profile.user_id) {
    const removed = await sql.query(`DELETE FROM users WHERE id = $1 AND role = 'MEMBER'`, [
      profile.user_id,
    ]);
    if ((removed.rowCount ?? 0) === 0) {
      throw new DomainError("FORBIDDEN", "연결된 멤버 계정을 지울 권한이 없습니다.");
    }
    memberDeleted = true;
  }

  const removed = await sql.query(`DELETE FROM profiles WHERE id = $1`, [profileId]);
  if ((removed.rowCount ?? 0) === 0) {
    throw new DomainError("FORBIDDEN", "이 프로필을 관리할 권한이 없습니다.");
  }

  return { storageKeys: keys.rows.map((r) => r.storage_key), memberDeleted };
}

// ── 주선자 메모 ───────────────────────────────────────────────

export type ProfileMemo = { body: string; updatedAt: string };

/**
 * 등록한 주선자의 메모. 남이 부르면 RLS 가 행을 가려 메모가 없는 것과 같다(0059).
 */
export async function findProfileMemo(sql: Sql, profileId: string): Promise<ProfileMemo | null> {
  const result = await sql.query<{ body: string; updated_at: Date }>(
    `SELECT body, updated_at FROM profile_memos WHERE profile_id = $1`,
    [profileId],
  );
  const row = result.rows[0];
  return row ? { body: row.body, updatedAt: row.updated_at.toISOString() } : null;
}

/** 메모를 덮어쓴다. 빈 글은 지운다 — 빈 메모 행을 남기지 않는다. */
export async function saveProfileMemo(
  sql: Sql,
  profileId: string,
  body: string,
): Promise<ProfileMemo | null> {
  if (body === "") {
    await sql.query(`DELETE FROM profile_memos WHERE profile_id = $1`, [profileId]);
    return null;
  }
  const result = await sql.query<{ body: string; updated_at: Date }>(
    `INSERT INTO profile_memos (profile_id, body) VALUES ($1, $2)
     ON CONFLICT (profile_id) DO UPDATE SET body = EXCLUDED.body
     RETURNING body, updated_at`,
    [profileId, body],
  );
  const row = result.rows[0]!;
  return { body: row.body, updatedAt: row.updated_at.toISOString() };
}

// ── 관리자 목록 ───────────────────────────────────────────────

/**
 * 주선자 목록의 WHERE 절. 목록과 조건 설정 시트의 「N명 보기」가 같은 절을 써야
 * 미리 본 숫자와 눌렀을 때 나오는 사람 수가 같다.
 */
function adminProfileWhere(
  query: AdminProfileQuery,
  scope: { groupId: string | null },
): { where: string; values: unknown[] } {
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
  // 나이·키·지역·직업군·태그는 멤버 탐색과 같은 절이다.
  clauses.push(...buildAttributeClauses(query, new Date().getFullYear(), push));
  if (query.q) {
    // `17번` 은 공개 번호, `#여행` 은 해시태그다. 숫자인지로 가른다.
    // 적는 방식을 따지지 않는다 — `17` · `17번` · 예전 표기 `#17` 을 모두 번호로 받는다.
    const codeMatch = /^[@#]?(\d+)\s*번?$/.exec(query.q);
    const needle = query.q.replace(/^[@#]+/u, "").trim();
    const term = push(`%${needle.length > 0 ? needle : query.q}%`);
    const codeClause = codeMatch ? ` OR p.public_code = ${push(Number(codeMatch[1]))}` : "";
    // 카카오톡에서 Ctrl+F 로 찾던 말(「송파」 「치과」 「교회」)이 걸리도록 정리된 글과
    // 가져올 때 받은 원문·내 메모까지 훑는다. 둘 다 RLS 가 담당인 것만 보여준다.
    // 이름은 담당일 때만 검색에 건다 — 아니면 검색 결과가 이름을 확인해 주는 통로가 된다.
    clauses.push(
      `((p.real_name ILIKE ${term} AND app_can_edit_profile(p.id))
        OR p.job_title ILIKE ${term} OR p.company ILIKE ${term} OR p.education ILIKE ${term}
        OR p.bio ILIKE ${term} OR p.ideal_type_text ILIKE ${term}
        OR array_to_string(p.hobbies, ' ') ILIKE ${term}
        OR array_to_string(p.hashtags, ' ') ILIKE ${term}
        OR EXISTS (SELECT 1 FROM import_sessions s
                    WHERE s.committed_profile_id = p.id AND s.raw_text ILIKE ${term})
        OR EXISTS (SELECT 1 FROM profile_memos m
                    WHERE m.profile_id = p.id AND m.body ILIKE ${term})${codeClause})`,
    );
  }

  return { where: clauses.join(" AND "), values };
}

/** 조건에 맞는 사람 수만. 조건 설정 시트가 고르는 동안 미리 보여준다. */
export async function countAdminProfiles(
  sql: Sql,
  query: AdminProfileQuery,
  scope: { groupId: string | null },
): Promise<number> {
  const { where, values } = adminProfileWhere(query, scope);
  const result = await sql.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM profiles p WHERE ${where}`,
    values,
  );
  return result.rows[0]?.total ?? 0;
}

export async function findAdminProfiles(
  sql: Sql,
  query: AdminProfileQuery,
  /** 지금 보고 있는 채널. null 이면 전체공개 풀만 본다. */
  scope: { groupId: string | null },
): Promise<{ items: ProfileRecord[]; nextCursor: string | null; total: number }> {
  const { where, values } = adminProfileWhere(query, scope);
  const countResult = await sql.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM profiles p WHERE ${where}`,
    values,
  );

  let clause = where;
  const cursor = decodeCursor(query.cursor);
  if (cursor) {
    values.push(cursor.hasPhoto, cursor.listedAt, cursor.id);
    clause += ` AND ${profileCursorClause(`$${values.length - 2}`, `$${values.length - 1}`, `$${values.length}`)}`;
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
            listedAt: last.listed_at,
            id: last.id,
          })
        : null,
  };
}
