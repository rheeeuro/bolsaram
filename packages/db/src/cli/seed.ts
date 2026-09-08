/**
 * 개발용 시드.
 *
 * **합성 데이터만 사용한다** (부트스트랩 §3, 설계문서 §12).
 * 실제 인물의 이름·사진·연락처를 넣지 않는다. 사진은 코드로 생성한 SVG 이며
 * 어떤 실존 인물도 나타내지 않는다.
 */
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePools, withOwner } from "../client";
import { loadDotEnv } from "./dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const ADMIN_EMAIL = "admin@bolsaram.local";
const ADMIN_PASSWORD = "bolsaram-admin";

/** 실존 인물과 겹치지 않도록 지어낸 두 글자 이름. */
const GIVEN_NAMES = [
  "가온",
  "노을",
  "다온",
  "라온",
  "미르",
  "바다",
  "새롬",
  "아라",
  "이든",
  "하늘",
  "한별",
  "여울",
  "누리",
  "슬기",
  "차온",
  "예온",
];
const FAMILY_NAMES = ["강", "남", "도", "류", "모", "부", "선", "여"];

const JOBS: [string, string][] = [
  ["백엔드 개발자", "IT"],
  ["프로덕트 디자이너", "DESIGN"],
  ["브랜드 마케터", "MARKETING"],
  ["자산운용 애널리스트", "FINANCE"],
  ["중학교 교사", "EDUCATION"],
  ["약사", "MEDICAL"],
  ["변리사", "PROFESSIONAL"],
  ["공공기관 주무관", "PUBLIC"],
  ["스튜디오 대표", "BUSINESS"],
  ["방송 작가", "ART"],
];

const REGIONS = ["SEOUL", "GYEONGGI", "INCHEON", "BUSAN", "DAEJEON"] as const;
const RELIGIONS = ["NONE", "CHRISTIAN", "CATHOLIC", "BUDDHIST"] as const;
const SMOKING = ["NONE", "NONE", "OCCASIONAL", "REGULAR"] as const;
const DRINKING = ["NONE", "OCCASIONAL", "SOCIAL", "REGULAR"] as const;
const MBTI = ["ENFP", "INFJ", "ISTJ", "ENTJ", "ISFP", "ENFJ", "INTP", "ESFJ"] as const;
const HOBBIES = [
  ["운동", "여행", "사진"],
  ["요리", "전시", "산책"],
  ["러닝", "커피", "독서"],
  ["클라이밍", "영화", "음악"],
  ["테니스", "베이킹", "드라이브"],
];
const BIOS = [
  "일상의 작은 순간을 소중히 여깁니다. 좋은 사람과 좋은 시간을 함께하고 싶어요.",
  "주말에는 주로 밖에서 시간을 보냅니다. 새로운 걸 배우는 걸 좋아해요.",
  "말수는 적은 편이지만 한번 친해지면 편하게 지냅니다.",
  "계획을 세우는 것도, 즉흥적인 것도 다 좋아합니다.",
];
const IDEALS = [
  "대화가 잘 통하고 서로의 시간을 존중해주는 분이면 좋겠어요.",
  "함께 있을 때 편안한 분을 만나고 싶습니다.",
  "취미를 같이 즐길 수 있는 분이면 더 좋겠어요.",
];

function pick<T>(list: readonly T[], index: number): T {
  return list[index % list.length]!;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize("NFKC"), salt, 64, { N: 16384 });
  return `scrypt$16384$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** 코드로 만든 자리표시 이미지. 실제 사진이 아니다. */
function placeholderSvg(seed: string, labelText: string): Buffer {
  const hue = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 4), 16) % 360;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="hsl(${hue} 34% 86%)"/>
    <stop offset="100%" stop-color="hsl(${(hue + 28) % 360} 26% 72%)"/>
  </linearGradient></defs>
  <rect width="600" height="800" fill="url(#g)"/>
  <circle cx="300" cy="320" r="112" fill="hsl(${hue} 22% 96%)" opacity="0.75"/>
  <path d="M140 800c0-96 72-160 160-160s160 64 160 160z" fill="hsl(${hue} 22% 96%)" opacity="0.75"/>
  <text x="300" y="742" text-anchor="middle" font-family="sans-serif" font-size="30"
        fill="hsl(${hue} 30% 32%)">${labelText}</text>
</svg>`,
    "utf8",
  );
}

async function main(): Promise<void> {
  loadDotEnv();
  const storageRoot = path.resolve(ROOT, process.env.STORAGE_ROOT ?? "var/storage");

  await withOwner(async (sql) => {
    const existing = await sql.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM profiles`,
    );
    if ((existing.rows[0]?.count ?? 0) > 0 && process.env.SEED_FORCE !== "yes") {
      console.info(
        "이미 데이터가 있습니다. 다시 시드하려면 `pnpm db:reset && pnpm db:migrate` 후 실행하거나 SEED_FORCE=yes 를 설정하세요.",
      );
      return;
    }

    // ── 관리자 ──────────────────────────────────────────────
    const admin = await sql.query<{ id: string }>(
      `INSERT INTO users (role, email, password_hash, display_name)
       VALUES ('ADMIN', $1, $2, '주선자')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [ADMIN_EMAIL, hashPassword(ADMIN_PASSWORD)],
    );
    const adminId = admin.rows[0]!.id;

    // ── 프로필 ──────────────────────────────────────────────
    const profileIds: string[] = [];
    const total = 24;

    for (let i = 0; i < total; i += 1) {
      const gender = i % 2 === 0 ? "FEMALE" : "MALE";
      const [jobTitle, jobCategory] = pick(JOBS, i);
      const birthYear = 1988 + (i % 12);
      const height = gender === "FEMALE" ? 158 + (i % 12) : 170 + (i % 14);
      const realName = `${pick(FAMILY_NAMES, i)}${pick(GIVEN_NAMES, i * 3 + 1)}`;

      // 앞의 20명은 공개, 나머지는 게시 대기 상태로 둬서 관리자 화면을 실제처럼 만든다.
      const published = i < 20;

      const inserted = await sql.query<{ id: string; public_code: number }>(
        `INSERT INTO profiles (
           gender, birth_year, height, job_title, job_category, company, education,
           residence_region, workplace_region, religion, mbti, smoking, drinking,
           hobbies, bio, ideal_type_text, real_name, contact_note,
           status, visibility, created_by, is_seed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
                 -- 합성 데이터라는 표식. 실데이터와 섞였을 때
                 -- pnpm db:purge-seed 가 이걸 보고 걷어낸다.
                 true)
         RETURNING id, public_code`,
        [
          gender,
          birthYear,
          height,
          jobTitle,
          jobCategory,
          `${pick(["가온", "누리", "온", "여울"], i)}컴퍼니`,
          pick(["OO대학교 학사", "OO대학교 석사", "OO대학교 학사"], i),
          pick(REGIONS, i),
          pick(REGIONS, i + 1),
          pick(RELIGIONS, i),
          pick(MBTI, i),
          pick(SMOKING, i),
          pick(DRINKING, i),
          pick(HOBBIES, i),
          pick(BIOS, i),
          pick(IDEALS, i),
          realName,
          `카카오톡 ID: sample_${1000 + i}`,
          published ? "ACTIVE" : "INACTIVE",
          published ? "LISTED" : "PRIVATE",
          adminId,
        ],
      );
      const profile = inserted.rows[0]!;
      profileIds.push(profile.id);

      // 사진 2장 (합성 SVG)
      for (let n = 0; n < 2; n += 1) {
        const key = `profile/${profile.id}/seed-${n}.svg`;
        const full = path.join(storageRoot, key);
        await mkdir(path.dirname(full), { recursive: true });
        const svg = placeholderSvg(`${profile.id}:${n}`, `#${profile.public_code}`);
        await writeFile(full, svg, { mode: 0o600 });
        await sql.query(
          `INSERT INTO profile_images
             (profile_id, storage_key, mime_type, byte_size, sort_order, is_primary)
           VALUES ($1, $2, 'image/svg+xml', $3, $4, $5)`,
          [profile.id, key, svg.byteLength, n, n === 0],
        );
      }
    }

    // ── 회원 계정 + Claim (앞 6명) ─────────────────────────
    for (let i = 0; i < 6; i += 1) {
      const phone = `0102000${String(1000 + i)}`;
      const user = await sql.query<{ id: string }>(
        `INSERT INTO users (role, phone, display_name) VALUES ('MEMBER', $1, $2) RETURNING id`,
        [phone, `회원${i + 1}`],
      );
      await sql.query(`UPDATE profiles SET user_id = $2 WHERE id = $1`, [
        profileIds[i]!,
        user.rows[0]!.id,
      ]);
    }

    // ── 신청 몇 건 (상태 기계를 눈으로 확인하기 위해) ────
    const [a, b, c, d, e, f] = profileIds as [string, string, string, string, string, string];
    await sql.query(
      `INSERT INTO match_requests (requester_profile_id, target_profile_id, status, message)
       VALUES ($1,$2,'REQUESTED','안녕하세요, 프로필 보고 연락드려요.')`,
      [a, b],
    );
    await sql.query(
      `INSERT INTO match_requests (requester_profile_id, target_profile_id, status, message, responded_at)
       VALUES ($1,$2,'ACCEPTED','취미가 비슷해서 반가웠어요.', now())`,
      [c, d],
    );
    await sql.query(
      `INSERT INTO match_requests
         (requester_profile_id, target_profile_id, status, responded_at, introduced_at, introduce_note)
       VALUES ($1,$2,'INTRODUCED', now(), now(), '두 분 연락처를 전달드렸어요. 좋은 인연 되시길 바랍니다.')`,
      [e, f],
    );

    console.info(
      [
        "시드 완료",
        `  프로필 ${total}개 (공개 20 / 대기 4), 사진 ${total * 2}장`,
        `  회원 계정 6개 — 로그인 번호 01020001000 ~ 01020001005`,
        `  관리자 — ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`,
        "",
        "  모든 인물 정보와 사진은 합성 데이터입니다.",
        `  회원은 비밀번호가 없습니다 — 관리자 화면에서 초대 링크를 발급해 로그인합니다.`,
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
