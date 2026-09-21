/**
 * 개발용 시드.
 *
 * **합성 데이터만 사용한다** (부트스트랩 §3, 설계문서 §12).
 * 실제 인물의 이름·사진·연락처를 넣지 않는다. 시드가 읽는 샘플(`db/sample/`)은
 * git 에 올라가지 않으며, 지어낸 인물의 프로필 글과 사진만 둔다.
 *
 * 하는 일:
 *   1) 주선자 두 명(`SEED_ADMIN_EMAIL1` · `SEED_ADMIN_EMAIL2`)을 만들거나 찾는다.
 *   2) 1번이 모임 하나를 만들고 2번이 같은 모임에 합류한다.
 *   3) 샘플 디렉터리를 번호순으로 반씩 나눠 각자 명의로 등록한다
 *      (앞쪽 = 1번, 뒤쪽 = 2번). 사진은 private 스토리지로 복사한다.
 *   4) 프로필마다 가져오기 세션을 남긴다 — `profile.txt` 원문과 사진, 그 원문에서
 *      뽑은 항목까지. 운영에서는 모든 프로필이 이 경로로 들어오고, 주선자 화면의
 *      「원본 보기」와 가져오기 검토 화면이 그 세션을 읽는다.
 *
 * 샘플 한 사람 = 디렉터리 하나다.
 *
 *   db/sample/01_사람/
 *     profile.txt   카카오톡에서 복사한 형태의 프로필 글
 *     01.jpg …      사진 (이름순으로 정렬, 첫 장이 대표)
 */
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeHashtags,
  REGION_LABELS,
  type Gender,
  type JobCategory,
  type Region,
} from "@bolsaram/schemas";
import { closePools, withOwner } from "../client";
import { loadDotEnv } from "./dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** 1번 주선자가 만드는 모임. 2번은 같은 모임에 합류한다. */
const GROUP_NAME = "애니메이션 모임";

/** 샘플 데이터 위치. git 제외 디렉터리라 없을 수 있고, 그때는 이유를 말하고 멈춘다. */
const SAMPLE_DIR = path.resolve(ROOT, process.env.SEED_SAMPLE_DIR?.trim() || "db/sample");

/**
 * 몇 번까지를 1번 주선자가 맡는가. 디렉터리 이름 앞의 번호로 가른다
 * (`01_…` ~ `10_…` 은 1번, 그 뒤는 2번).
 */
const FIRST_ADMIN_UNTIL = Number(process.env.SEED_SPLIT_AT?.trim() || 10);

/**
 * 성별은 프로필 글에 없다 — 카카오톡에서 오는 글이 대개 그렇고, 주선자가 검토 화면에서
 * 채우는 값이다. 시드는 그 손길을 대신해 번호 구간으로 지정한다.
 * `성별: 남/여` 줄이 글에 있으면 그쪽이 이긴다.
 */
const GENDER_RANGES: [from: number, to: number, gender: Gender][] = [
  [1, 5, "MALE"],
  [6, 10, "FEMALE"],
  [11, 15, "MALE"],
  [16, 20, "FEMALE"],
];

/**
 * 직업군 추정. 운영에서는 AI 가 뽑고 주선자가 고치는 값이라 여기서는 키워드로만 본다.
 * **순서가 판정이다** — 먼저 걸리는 규칙이 이긴다(「헤어 디자이너」는 디자인이 아니라 서비스).
 */
const JOB_RULES: [RegExp, JobCategory][] = [
  [/개발|엔지니어|데이터|보안|프로그래|서버|IT|PM|프로덕트/u, "IT"],
  [/의사|전문의|간호|약사|병원|한의|수의/u, "MEDICAL"],
  [/교사|교수|강사|교육|유치원|어린이집/u, "EDUCATION"],
  [/금융|은행|증권|보험|자산운용|애널리스트|회계/u, "FINANCE"],
  [/헤어|메이크업|네일|바리스타|승무원|트레이너|코치|바 운영|서비스/u, "SERVICE"],
  [/디자이너|디자인|디렉터/u, "DESIGN"],
  [/크리에이터|작가|음악|영상|배우|공연|예술|아트/u, "ART"],
  [/마케|MD|홍보|광고|브랜드|콘텐츠 전략/u, "MARKETING"],
  [/변호사|변리사|세무사|노무사|컨설턴트|연구원/u, "PROFESSIONAL"],
  [/대표|창업|기획|영업|경영|사업|운영/u, "BUSINESS"],
  [/공무원|주무관|공공|공단|공사/u, "PUBLIC"],
];

/** 프로필 글이 쓰는 항목 이름. 여기 없는 줄은 바로 앞 항목의 다음 줄로 본다. */
const FIELD_KEYS = [
  "이름",
  "성별",
  "나이",
  "키",
  "하는 일",
  "직장",
  "학력",
  "거주지",
  "취미",
  "해시태그",
  "원하는 이성상",
  "자기소개",
  "연락처",
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

type SampleProfile = {
  /** 디렉터리 이름 앞의 번호. 담당 주선자와 성별을 가르는 기준이다. */
  number: number;
  dirName: string;
  /** `profile.txt` 를 손대지 않은 그대로. 가져오기 세션의 원문이 된다. */
  rawText: string;
  fields: Partial<Record<FieldKey, string>>;
  images: { file: string; mimeType: string }[];
};

const IMAGE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback?.trim();
  if (!value) {
    throw new Error(
      `${name} 이 비어 있습니다. .env 에 주선자 계정 이메일을 넣고 다시 실행하세요 — ` +
        `본인 카카오·구글 계정의 이메일을 넣으면 첫 로그인에서 그 계정에 이어붙습니다.`,
    );
  }
  return value;
}

/** 프로필 글을 항목별로 쪼갠다. 자기소개처럼 여러 줄인 값은 다음 항목 전까지 이어 붙인다. */
function parseProfileText(text: string): Partial<Record<FieldKey, string>> {
  const fields: Partial<Record<FieldKey, string>> = {};
  let current: FieldKey | null = null;
  const buffer: string[] = [];

  const flush = (): void => {
    if (current == null) return;
    const value = buffer.join("\n").trim();
    if (value.length > 0) fields[current] = value;
    buffer.length = 0;
  };

  for (const line of text.split("\n")) {
    const key = FIELD_KEYS.find((k) => line.trimStart().startsWith(`${k}:`));
    if (key) {
      flush();
      current = key;
      buffer.push(line.trimStart().slice(key.length + 1).trim());
    } else if (current != null) {
      buffer.push(line.trim());
    }
  }
  flush();
  return fields;
}

/** `97년생` · `1997` · `97` → 1997. 두 자리는 30 을 경계로 19xx/20xx 를 가른다. */
function parseBirthYear(raw: string | undefined, where: string): number {
  const digits = raw?.match(/\d{2,4}/u)?.[0];
  if (!digits) throw new Error(`${where}: 나이(출생연도)를 읽지 못했습니다 — "${raw ?? ""}"`);
  const value = digits.length <= 2 ? (Number(digits) >= 30 ? 1900 : 2000) + Number(digits) : Number(digits);
  if (value < 1960 || value > 2010) {
    throw new Error(`${where}: 출생연도 ${value} 는 허용 범위(1960~2010) 밖입니다.`);
  }
  return value;
}

function parseHeight(raw: string | undefined): number | null {
  const digits = raw?.match(/\d{2,3}/u)?.[0];
  if (!digits) return null;
  const value = Number(digits);
  return value >= 130 && value <= 220 ? value : null;
}

/** `서울 송파구` → SEOUL. 광역 단위까지만 쓴다(설계문서 §5) — 구·동은 버린다. */
function parseRegion(raw: string | undefined, where: string): Region {
  const text = (raw ?? "").trim();
  const entries = Object.entries(REGION_LABELS) as [Region, string][];
  // 긴 라벨부터 본다 — 「경남」이 「경」으로 먼저 걸리는 일을 막는다.
  const matched = entries
    .sort((a, b) => b[1].length - a[1].length)
    .find(([, label]) => text.startsWith(label));
  if (!matched) throw new Error(`${where}: 거주지 "${text}" 를 광역 단위로 읽지 못했습니다.`);
  return matched[0];
}

function parseJobCategory(jobTitle: string | null): JobCategory | null {
  if (!jobTitle) return null;
  return JOB_RULES.find(([pattern]) => pattern.test(jobTitle))?.[1] ?? "OTHER";
}

/** `러닝, 맛집 탐방` → ["러닝", "맛집 탐방"]. 상한은 profiles_hobbies_len 과 같다. */
function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,·/]/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 12);
}

function parseGender(raw: string | undefined, number: number, where: string): Gender {
  if (raw) {
    if (/^(남|MALE)/iu.test(raw.trim())) return "MALE";
    if (/^(여|FEMALE)/iu.test(raw.trim())) return "FEMALE";
  }
  const matched = GENDER_RANGES.find(([from, to]) => number >= from && number <= to);
  if (!matched) {
    throw new Error(
      `${where}: 성별을 알 수 없습니다. 프로필 글에 "성별: 남" 줄을 넣거나 시드의 GENDER_RANGES 에 ${number} 번이 드는 구간을 추가하세요.`,
    );
  }
  return matched[2];
}

/**
 * 원문에서 뽑은 항목. **AI 추출 결과와 같은 모양**이다 — 시드가 남기는 가져오기
 * 세션의 추출 결과가 그대로 이 값이고, 프로필도 같은 값으로 만든다.
 * 이름·연락처는 여기에 없다 — 추출 대상이 아니라 주선자가 적는 값이다.
 */
type SampleFields = {
  gender: Gender;
  birthYear: number;
  height: number | null;
  jobTitle: string | null;
  jobCategory: JobCategory | null;
  company: string | null;
  education: string | null;
  residenceRegion: Region;
  workplaceRegion: null;
  religion: null;
  mbti: null;
  smoking: null;
  drinking: null;
  hobbies: string[];
  hashtags: string[];
  bio: string | null;
  idealTypeText: string | null;
};

function fieldsOf(sample: SampleProfile): SampleFields {
  const where = `${sample.dirName}/profile.txt`;
  const jobTitle = sample.fields["하는 일"] ?? null;
  const hobbies = parseList(sample.fields["취미"]);
  return {
    gender: parseGender(sample.fields["성별"], sample.number, where),
    birthYear: parseBirthYear(sample.fields["나이"], where),
    height: parseHeight(sample.fields["키"]),
    jobTitle,
    jobCategory: parseJobCategory(jobTitle),
    company: sample.fields["직장"] ?? null,
    education: sample.fields["학력"] ?? null,
    residenceRegion: parseRegion(sample.fields["거주지"], where),
    // 샘플 글에 없는 항목. 운영에서는 AI 가 뽑거나 주선자가 검토 화면에서 채운다.
    workplaceRegion: null,
    religion: null,
    mbti: null,
    smoking: null,
    drinking: null,
    hobbies,
    // 글에 해시태그가 없으면 취미를 태그 형태로 옮긴다 — 검색이 실제처럼 걸린다.
    hashtags: normalizeHashtags(
      sample.fields["해시태그"] ? parseList(sample.fields["해시태그"]) : hobbies,
    ),
    bio: sample.fields["자기소개"] ?? null,
    idealTypeText: sample.fields["원하는 이성상"] ?? null,
  };
}

/** 값이 있는 항목만 확신한다고 본다 — 검토 화면의 「확인 필요」가 이 값으로 갈린다. */
function confidenceOf(fields: SampleFields): Record<string, number> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => (Array.isArray(value) ? value.length > 0 : value != null))
      .map(([key]) => [key, 1]),
  );
}

/** 샘플 디렉터리를 번호순으로 읽는다. 사진이나 글이 없는 디렉터리는 건너뛴다. */
async function readSamples(): Promise<SampleProfile[]> {
  let entries;
  try {
    entries = await readdir(SAMPLE_DIR, { withFileTypes: true });
  } catch {
    throw new Error(
      `샘플 데이터를 찾지 못했습니다: ${SAMPLE_DIR}\n` +
        `  이 디렉터리는 git 에 올라가지 않습니다. 사람 하나당 디렉터리 하나를 두고\n` +
        `  그 안에 profile.txt 와 사진을 넣거나, SEED_SAMPLE_DIR 로 다른 위치를 지정하세요.`,
    );
  }

  const samples: SampleProfile[] = [];
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(SAMPLE_DIR, entry.name);
    const files = await readdir(dir);
    if (!files.includes("profile.txt")) continue;

    const images = files
      .filter((file) => IMAGE_TYPES[path.extname(file).toLowerCase()] != null)
      .sort((a, b) => a.localeCompare(b))
      .map((file) => ({ file, mimeType: IMAGE_TYPES[path.extname(file).toLowerCase()]! }));

    const rawText = await readFile(path.join(dir, "profile.txt"), "utf8");
    samples.push({
      number: Number(entry.name.match(/^\d+/u)?.[0] ?? samples.length + 1),
      dirName: entry.name,
      rawText,
      fields: parseProfileText(rawText),
      images,
    });
  }
  if (samples.length === 0) {
    throw new Error(`${SAMPLE_DIR} 안에 profile.txt 를 가진 디렉터리가 없습니다.`);
  }
  return samples.sort((a, b) => a.number - b.number);
}

/** 저장 키에 난수를 넣는다 — 키를 짐작해서 다른 사람의 사진에 닿을 수 없어야 한다. */
function storageKeyFor(profileId: string, mimeType: string): string {
  const ext = Object.entries(IMAGE_TYPES).find(([, type]) => type === mimeType)?.[0] ?? ".bin";
  const random = randomBytes(12).toString("base64url");
  return `profile/${profileId}/${random}${ext}`;
}

async function main(): Promise<void> {
  loadDotEnv();
  const storageRoot = path.resolve(ROOT, process.env.STORAGE_ROOT ?? "var/storage");
  const adminEmails = [
    requireEnv("SEED_ADMIN_EMAIL1", process.env.SEED_ADMIN_EMAIL),
    requireEnv("SEED_ADMIN_EMAIL2"),
  ];
  if (adminEmails[0]!.toLowerCase() === adminEmails[1]!.toLowerCase()) {
    throw new Error("SEED_ADMIN_EMAIL1 과 SEED_ADMIN_EMAIL2 가 같습니다. 서로 다른 계정이어야 합니다.");
  }

  const samples = await readSamples();

  await withOwner(async (sql) => {
    const existing = await sql.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM profiles`,
    );
    const isEmpty = (existing.rows[0]?.count ?? 0) === 0;
    if (!isEmpty && process.env.SEED_FORCE !== "yes") {
      console.info(
        "이미 데이터가 있습니다. 다시 시드하려면 `pnpm db:reset && pnpm db:migrate` 후 실행하거나 SEED_FORCE=yes 를 설정하세요.",
      );
      return;
    }

    // 프로필이 하나도 없을 때만 스토리지를 비운다. 남아 있는 사진 파일은 전부
    // 참조를 잃은 것이라 지워도 되지만, 데이터가 있는 상태에서는 건드리지 않는다.
    if (isEmpty) {
      for (const namespace of ["profile", "import"]) {
        await rm(path.join(storageRoot, namespace), { recursive: true, force: true });
      }
    }

    // ── 주선자 두 명 ────────────────────────────────────────
    // 비밀번호가 없다. 이 계정으로 들어가려면 같은 이메일의 소셜 계정으로 로그인한다.
    const adminIds: string[] = [];
    for (const [index, email] of adminEmails.entries()) {
      const found = await sql.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
      if (found.rows[0]) {
        adminIds.push(found.rows[0].id);
        continue;
      }
      const created = await sql.query<{ id: string }>(
        `INSERT INTO users (role, email, display_name) VALUES ('ADMIN', $1, $2) RETURNING id`,
        [email, `주선자${index + 1}`],
      );
      adminIds.push(created.rows[0]!.id);
    }
    const [firstAdminId, secondAdminId] = adminIds as [string, string];

    // ── 모임 ────────────────────────────────────────────────
    // 1번이 만들고(OWNER) 2번이 합류한다. 소속을 만드는 것은 평소 인증 레이어뿐이고
    // (설계 규칙) 여기서는 owner 커넥션으로 그 경로를 대신한다.
    const group = await sql.query<{ id: string }>(
      `INSERT INTO groups (name, description, created_by) VALUES ($1, $2, $3) RETURNING id`,
      [GROUP_NAME, "시드가 만든 개발용 모임입니다.", firstAdminId],
    );
    const groupId = group.rows[0]!.id;
    await sql.query(
      `INSERT INTO group_admins (group_id, user_id, is_owner, added_by)
       VALUES ($1, $2, true, $2), ($1, $3, false, $2)`,
      [groupId, firstAdminId, secondAdminId],
    );
    // 보고 있는 모임(화면 필터). 권한은 group_admins 가 정한다.
    await sql.query(`UPDATE users SET active_group_id = $1 WHERE id = ANY($2::uuid[])`, [
      groupId,
      adminIds,
    ]);

    // ── 프로필 ──────────────────────────────────────────────
    let imageCount = 0;
    let sessionCount = 0;
    const perAdmin = [0, 0];

    for (const sample of samples) {
      const owner = sample.number <= FIRST_ADMIN_UNTIL ? 0 : 1;
      const createdBy = adminIds[owner]!;
      const fields = fieldsOf(sample);

      const inserted = await sql.query<{ id: string }>(
        `INSERT INTO profiles (
           group_id, gender, birth_year, height, job_title, job_category, company, education,
           residence_region, hobbies, hashtags, bio, ideal_type_text, real_name, contact_note,
           status, visibility, created_by, is_seed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'ACTIVE','LISTED',$16,
                 -- 합성 데이터라는 표식. 실데이터와 섞였을 때
                 -- pnpm db:purge-seed 가 이걸 보고 걷어낸다.
                 true)
         RETURNING id`,
        [
          groupId,
          fields.gender,
          fields.birthYear,
          fields.height,
          fields.jobTitle,
          fields.jobCategory,
          fields.company,
          fields.education,
          fields.residenceRegion,
          fields.hobbies,
          fields.hashtags,
          fields.bio,
          fields.idealTypeText,
          sample.fields["이름"] ?? null,
          // 연락처는 연결된 뒤에만 보인다. 샘플에 없으면 합성 값을 넣어 그 화면을 확인할 수 있게 한다.
          sample.fields["연락처"] ?? `카카오톡 ID: sample_${String(1000 + sample.number)}`,
          createdBy,
        ],
      );
      const profileId = inserted.rows[0]!.id;
      perAdmin[owner] = perAdmin[owner]! + 1;

      const stored: { key: string; file: string; mimeType: string; byteSize: number }[] = [];
      for (const [order, image] of sample.images.entries()) {
        const key = storageKeyFor(profileId, image.mimeType);
        const bytes = await readFile(path.join(SAMPLE_DIR, sample.dirName, image.file));
        const full = path.join(storageRoot, key);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, bytes, { mode: 0o600 });
        await sql.query(
          `INSERT INTO profile_images
             (profile_id, storage_key, mime_type, byte_size, sort_order, is_primary)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [profileId, key, image.mimeType, bytes.byteLength, order, order === 0],
        );
        stored.push({ key, file: image.file, mimeType: image.mimeType, byteSize: bytes.byteLength });
        imageCount += 1;
      }

      // ── 가져오기 원본 ─────────────────────────────────────
      // 운영에서 프로필은 언제나 가져오기 세션을 거쳐 만들어진다. 시드도 같은 자취를
      // 남긴다 — 「원본 보기」와 검토 화면은 프로필이 아니라 이 세션의 원문을 읽는다.
      // 사진은 주선자가 웹에서 올린 것과 같은 자리(MANUAL_UPLOAD)에 둔다.
      const session = await sql.query<{ id: string }>(
        `INSERT INTO import_sessions
           (group_id, created_by, source, status, raw_text,
            committed_profile_id, committed_at, idempotency_key)
         VALUES ($1, $2, 'MANUAL_UPLOAD', 'IMPORTED', $3, $4, now(), $5)
         RETURNING id`,
        [groupId, createdBy, sample.rawText, profileId, `seed:${profileId}`],
      );
      const sessionId = session.rows[0]!.id;
      sessionCount += 1;

      for (const [order, image] of stored.entries()) {
        // 프로필 사진과 **같은 저장 키**를 가리킨다. 실제 commit 경로도 파일을
        // 복사하지 않고 키를 물려준다(`moveImagesToProfile`).
        await sql.query(
          `INSERT INTO import_assets
             (import_session_id, type, storage_key, original_filename, mime_type,
              byte_size, sort_order, uploaded_at)
           VALUES ($1, 'IMAGE', $2, $3, $4, $5, $6, now())`,
          [sessionId, image.key, image.file, image.mimeType, image.byteSize, order],
        );
      }

      // 추출 결과도 함께 남긴다 — 등록된 세션에 추출이 없는 상태는 운영에서 나오지
      // 않는다(게시 게이트가 항목을 요구한다). 모델을 부르지 않았으므로 모델 이름은
      // `seed` 이고, 주선자가 검토를 마친 값으로 곧장 넣는다.
      const fieldsJson = JSON.stringify(fields);
      await sql.query(
        `INSERT INTO import_extractions
           (import_session_id, fields_json, confidence_json, model, prompt_version,
            reviewed_fields_json, reviewed_by, reviewed_at)
         VALUES ($1, $2, $3, 'seed', 'seed', $2, $4, now())`,
        [sessionId, fieldsJson, JSON.stringify(confidenceOf(fields)), createdBy],
      );
    }

    console.info(
      [
        "시드 완료",
        `  모임 「${GROUP_NAME}」 — 주선자 2명`,
        `    ${adminEmails[0]} (모임장) — 프로필 ${perAdmin[0]}개`,
        `    ${adminEmails[1]} — 프로필 ${perAdmin[1]}개`,
        `  프로필 ${samples.length}개 전부 공개(ACTIVE·LISTED), 사진 ${imageCount}장`,
        `  가져오기 원본 ${sessionCount}건 — 프로필마다 원문과 사진이 세션으로 남습니다`,
        `  샘플 원본: ${path.relative(ROOT, SAMPLE_DIR)}`,
        "",
        "  두 주선자 모두 비밀번호가 없습니다 — 같은 이메일의 카카오·구글 계정으로 로그인합니다.",
        "  멤버 계정은 만들지 않았습니다. 주선자 화면에서 프로필 상세 → 초대 링크로 들어갑니다.",
        "  모든 인물 정보와 사진은 합성 데이터입니다.",
      ].join("\n"),
    );
  });
}

main()
  .then(() => closePools())
  .catch(async (error: unknown) => {
    console.error(error);
    await closePools();
    process.exitCode = 1;
  });
