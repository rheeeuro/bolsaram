/**
 * 시작 가이드(`/guide`) 의 화면 사진을 만든다.
 *
 *   pnpm guide:screenshots
 *
 * **운영 DB 를 찍지 않는다.** 실제 멤버의 사진과 글이 화면에 나오기 때문이다. 대신
 *
 *   1) 같은 컨테이너에 `<DB 이름>_guide` 를 새로 만들고 마이그레이션한다
 *   2) 지어낸 인물의 프로필 글과 **그림으로 그린 사진**을 만들어 시드에 넘긴다
 *   3) 빌드된 웹 앱을 다른 포트(기본 3031)에서 그 DB·임시 스토리지로 띄운다
 *   4) 초대·신청·채팅·가져오기를 실제 API 와 화면으로 만들어 두고 찍는다
 *
 * 결과는 `apps/web/public/guide/` 에 JPEG 로 남는다. 화면이 바뀌면 다시 돌린다 —
 * 빌드가 먼저 돼 있어야 한다(`pnpm build`). 운영 앱(3020)은 건드리지 않는다.
 *
 * 텔레그램 대화는 찍을 수 없어서 봇의 실제 문구(`server/telegram/messages.ts`)로
 * 대화창을 그려 넣는다.
 *
 * 이 호스트처럼 Chromium 이 쓰는 시스템 라이브러리나 한글 폰트가 없으면, 패키지를
 * 설치하지 않고 `.deb` 를 풀어 둔 위치를 알려준다(`scripts/README.md` 참고).
 *
 *   GUIDE_CHROMIUM_LIBS   공유 라이브러리 디렉터리 → LD_LIBRARY_PATH
 *   GUIDE_CHROMIUM_FONTS  한글 폰트를 포함한 fonts.conf → FONTCONFIG_FILE
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { closePools, withOwner, withOwnerTx } from "../packages/db/src/client";
import { loadDotEnv } from "../packages/db/src/cli/dotenv";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "apps", "web", "public", "guide");
const WORK_DIR = path.join(tmpdir(), "bolsaram-guide-shots");
const PORT = Number(process.env.GUIDE_SHOT_PORT ?? 3031);
const ORIGIN = `http://127.0.0.1:${PORT}`;

const HOST_EMAIL = "host1@guide.bolsaram.local";
const COLLEAGUE_EMAIL = "host2@guide.bolsaram.local";
const GROUP_NAME = "주말 독서 모임";

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

// ── 합성 인물 ────────────────────────────────────────────────
// 시드는 디렉터리 번호로 담당과 성별을 가른다(01~05 남 · 06~10 여 = 1번 주선자,
// 11~15 남 · 16~20 여 = 2번). 이름·연락처는 전부 지어낸 것이다.

type Person = {
  dir: string;
  look: Look;
  text: string;
};

type Look = { hair: "short" | "long"; bg: [string, string]; shirt: string; skin: string; hairColor: string };

const PEOPLE: Person[] = [
  {
    dir: "01_도윤",
    look: { hair: "short", bg: ["#dfe7ef", "#b8c7d8"], shirt: "#3f5468", skin: "#efd2bd", hairColor: "#2b2522" },
    text: `이름: 한도윤
나이: 92년생
키: 178
하는 일: 백엔드 개발자
직장: 판교 IT 회사
학력: 공대 졸업
거주지: 서울 마포구
취미: 러닝, 보드게임, 주말 캠핑
원하는 이성상: 대화가 잘 통하고 웃음이 많은 분
자기소개: 평일엔 코드를 쓰고 주말엔 한강을 달립니다. 맛있는 국밥집을 많이 알아요.`,
  },
  {
    dir: "02_재현",
    look: { hair: "short", bg: ["#e9e2d6", "#cfc0a6"], shirt: "#6b5844", skin: "#e8c7ae", hairColor: "#3a2c24" },
    text: `이름: 서재현
나이: 90년생
키: 181
하는 일: 치과 전문의
직장: 강남 치과의원
학력: 치의학 전문대학원
거주지: 서울 송파구
취미: 테니스, 재즈 공연
원하는 이성상: 자기 일을 아끼는 분
자기소개: 조용한 편이지만 좋아하는 이야기에는 말이 많아집니다.`,
  },
  {
    dir: "03_민준",
    look: { hair: "short", bg: ["#e2ebe0", "#b9cdb4"], shirt: "#4c6b55", skin: "#f0d5c0", hairColor: "#231d1b" },
    text: `이름: 오민준
나이: 94년생
키: 175
하는 일: 중학교 과학 교사
직장: 경기도 공립 중학교
학력: 사범대 졸업
거주지: 경기 성남시
취미: 등산, 사진, 독서
원하는 이성상: 함께 산책하며 이야기 나눌 수 있는 분
자기소개: 아이들과 실험하는 게 즐겁습니다. 방학엔 산에 갑니다.`,
  },
  {
    dir: "06_서연",
    look: { hair: "long", bg: ["#f3e3e0", "#e2bdb6"], shirt: "#a8636a", skin: "#f3d8c6", hairColor: "#3b2a24" },
    text: `이름: 윤서연
나이: 95년생
키: 164
하는 일: 브랜드 디자이너
직장: 성수동 디자인 스튜디오
학력: 시각디자인 전공
거주지: 서울 성동구
취미: 전시 보기, 필름 카메라, 베이킹
원하는 이성상: 다정하고 생활이 단정한 분
자기소개: 좋아하는 카페를 찾아다니는 게 취미예요. 주말엔 빵을 굽습니다.`,
  },
  {
    dir: "07_하은",
    look: { hair: "long", bg: ["#e6e3f1", "#c3bddc"], shirt: "#5d5785", skin: "#f1d4c0", hairColor: "#2a211f" },
    text: `이름: 정하은
나이: 93년생
키: 162
하는 일: 대학병원 간호사
직장: 서울 대학병원
학력: 간호학과 졸업
거주지: 서울 종로구
취미: 요가, 여행, 드라마
원하는 이성상: 배려가 몸에 밴 분
자기소개: 교대 근무라 쉬는 날을 알차게 보내려고 해요.`,
  },
  {
    dir: "08_지우",
    look: { hair: "long", bg: ["#f2eadb", "#dcc8a0"], shirt: "#8a7448", skin: "#f0d2bb", hairColor: "#4a3428" },
    text: `이름: 김지우
나이: 96년생
키: 167
하는 일: 콘텐츠 마케터
직장: 식품 회사 마케팅팀
학력: 경영학과 졸업
거주지: 서울 영등포구
취미: 수영, 맛집 탐방
원하는 이성상: 유머 감각 있는 분
자기소개: 새로운 곳 가 보는 걸 좋아합니다. 수영은 4년째 하고 있어요.`,
  },
  {
    dir: "11_우진",
    look: { hair: "short", bg: ["#dde6e8", "#adc3c8"], shirt: "#36606a", skin: "#ebcdb6", hairColor: "#1f1b1a" },
    text: `이름: 이우진
나이: 91년생
키: 176
하는 일: 회계사
직장: 회계법인
학력: 경영학과 졸업
거주지: 서울 강남구
취미: 골프, 클래식 음악
원하는 이성상: 차분하고 따뜻한 분
자기소개: 숫자를 다루지만 성격은 느긋한 편입니다.`,
  },
  {
    dir: "16_수아",
    look: { hair: "long", bg: ["#f1e1e8", "#d8b2c4"], shirt: "#87566d", skin: "#f2d6c4", hairColor: "#30231f" },
    text: `이름: 최수아
나이: 94년생
키: 160
하는 일: 바이오 연구원
직장: 제약회사 연구소
학력: 생명과학 석사
거주지: 경기 용인시
취미: 필라테스, 보드게임
원하는 이성상: 대화가 편한 분
자기소개: 실험실에서 일하고 퇴근 후엔 운동합니다.`,
  },
];

/** 가져오기 화면에서 직접 올릴 사람 — 아직 등록되지 않은 상태를 찍는다. */
const IMPORT_PERSON = {
  look: { hair: "long", bg: ["#e7efe9", "#bcd2c3"], shirt: "#557566", skin: "#f1d5c2", hairColor: "#2e2420" } as Look,
  // 성별을 일부러 적지 않는다 — 검토 화면에서 「채워 주세요」가 어떻게 보이는지 찍는다.
  text: `이름: 문채원
나이: 97년생
키: 163
직업: 병원 약사
직장: 분당 종합병원
사는 곳: 경기 성남
취미: 클라이밍, 전시 보기
#클라이밍 #전시회 #강아지
성격: 밝고 솔직한 편이에요. 주말엔 친구들이랑 암장 가요.
이상형: 대화가 잘 통하는 분`,
};

// ── 그림 사진 ────────────────────────────────────────────────
// 얼굴 없는 일러스트다. 실제 인물 사진을 가이드에 싣지 않는다.

function portraitSvg(look: Look): string {
  const hairBack =
    look.hair === "long"
      ? `<path d="M168 360 C 160 230, 230 196, 300 196 C 370 196, 440 230, 432 360 L 452 640 C 400 664, 200 664, 148 640 Z" fill="${look.hairColor}"/>`
      : "";
  const hairFront =
    look.hair === "long"
      ? `<path d="M180 352 C 182 250, 240 214, 300 214 C 372 214, 420 252, 420 352 C 392 300, 330 276, 268 286 C 232 292, 200 318, 180 352 Z" fill="${look.hairColor}"/>`
      : `<path d="M184 352 C 176 248, 236 206, 302 206 C 372 206, 426 250, 416 352 C 398 300, 350 270, 300 270 C 250 270, 204 300, 184 352 Z" fill="${look.hairColor}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${look.bg[0]}"/><stop offset="1" stop-color="${look.bg[1]}"/>
  </linearGradient></defs>
  <rect width="600" height="800" fill="url(#bg)"/>
  <circle cx="470" cy="150" r="70" fill="#ffffff" opacity="0.35"/>
  ${hairBack}
  <path d="M70 800 C 90 610, 510 610, 530 800 Z" fill="${look.shirt}"/>
  <rect x="262" y="470" width="76" height="120" rx="32" fill="${look.skin}"/>
  <ellipse cx="300" cy="372" rx="120" ry="140" fill="${look.skin}"/>
  ${hairFront}
</svg>`;
}

function sceneSvg(look: Look): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${look.bg[0]}"/><stop offset="1" stop-color="#fbf7f1"/>
  </linearGradient></defs>
  <rect width="600" height="800" fill="url(#sky)"/>
  <circle cx="420" cy="260" r="80" fill="#fff6e4"/>
  <path d="M0 560 C 120 470, 260 520, 360 480 C 450 446, 540 470, 600 500 L 600 800 L 0 800 Z" fill="${look.bg[1]}"/>
  <path d="M0 640 C 160 580, 300 640, 600 590 L 600 800 L 0 800 Z" fill="${look.shirt}" opacity="0.55"/>
  <ellipse cx="210" cy="640" rx="26" ry="30" fill="${look.skin}"/>
  <path d="M180 760 C 182 690, 238 690, 240 760 Z" fill="${look.shirt}"/>
</svg>`;
}

async function renderSvg(browser: Browser, svg: string, file: string): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 600, height: 800 } });
  await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  await page.screenshot({ path: file, type: "jpeg", quality: 90 });
  await page.close();
}

// ── DB 와 서버 ───────────────────────────────────────────────

function guideDbUrl(url: string): string {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.slice(1));
  parsed.pathname = `/${encodeURIComponent(`${name.replace(/_guide$/, "")}_guide`)}`;
  return parsed.toString();
}

function guideEnv(): NodeJS.ProcessEnv {
  const ownerUrl = process.env.DATABASE_URL;
  const appUrl = process.env.APP_DATABASE_URL;
  if (!ownerUrl || !appUrl) throw new Error("DATABASE_URL · APP_DATABASE_URL 이 필요합니다.");
  return {
    ...process.env,
    DATABASE_URL: guideDbUrl(ownerUrl),
    APP_DATABASE_URL: guideDbUrl(appUrl),
    // 사진은 임시 디렉터리에만 쓴다. 운영 스토리지(로컬·R2)를 건드리지 않는다.
    STORAGE_PROVIDER: "local",
    STORAGE_ROOT: path.join(WORK_DIR, "storage"),
    APP_ENV: "local",
    APP_ORIGIN: ORIGIN,
    AI_PROVIDER: "mock",
  };
}

async function recreateDatabase(): Promise<void> {
  const name = decodeURIComponent(new URL(guideDbUrl(process.env.DATABASE_URL!)).pathname.slice(1));
  if (!name.endsWith("_guide")) throw new Error(`가이드 DB 이름이 아닙니다: ${name}`);
  await withOwner(async (sql) => {
    const quoted = `"${name.replaceAll('"', '""')}"`;
    await sql.query(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`);
    await sql.query(`CREATE DATABASE ${quoted}`);
  });
  await closePools();
  execFileSync("pnpm", ["--filter", "@bolsaram/db", "migrate"], {
    cwd: ROOT,
    env: guideEnv(),
    stdio: ["ignore", "ignore", "inherit"],
  });
}

async function writeSamples(browser: Browser): Promise<string> {
  const sampleDir = path.join(WORK_DIR, "sample");
  await rm(sampleDir, { recursive: true, force: true });
  for (const person of PEOPLE) {
    const dir = path.join(sampleDir, person.dir);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "profile.txt"), `${person.text}\n`);
    await renderSvg(browser, portraitSvg(person.look), path.join(dir, "01.jpg"));
    await renderSvg(browser, sceneSvg(person.look), path.join(dir, "02.jpg"));
  }
  const importDir = path.join(WORK_DIR, "import");
  await mkdir(importDir, { recursive: true });
  await renderSvg(browser, portraitSvg(IMPORT_PERSON.look), path.join(importDir, "01.jpg"));
  await renderSvg(browser, sceneSvg(IMPORT_PERSON.look), path.join(importDir, "02.jpg"));
  return sampleDir;
}

function seed(sampleDir: string): void {
  execFileSync("pnpm", ["--filter", "@bolsaram/db", "seed"], {
    cwd: ROOT,
    env: {
      ...guideEnv(),
      SEED_SAMPLE_DIR: sampleDir,
      SEED_ADMIN_EMAIL1: HOST_EMAIL,
      SEED_ADMIN_EMAIL2: COLLEAGUE_EMAIL,
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
}

/**
 * 주선자 둘을 시드보다 먼저 만든다. 시드는 같은 이메일이 있으면 그 계정을 쓰므로,
 * 모임 채팅에 남는 「○○ 님」 이름이 처음부터 가이드용 이름이 된다.
 */
async function createHosts(): Promise<void> {
  await withOwnerTx(async (sql) => {
    await sql.query(
      `INSERT INTO users (role, email, display_name)
       VALUES ('ADMIN', $1, '김하늘'), ('ADMIN', $2, '이도담')`,
      [HOST_EMAIL, COLLEAGUE_EMAIL],
    );
  });
}

/**
 * 시드가 만든 모임 이름을 바꾸고, 모임을 하나 더 둔다(모임 전환을 보여주려고).
 *
 * 시드는 1번을 관리자로 두고 모임에서 뺀다. 가이드는 **보통 주선자의 화면**을 찍으므로
 * 관리자 지정을 풀고 1번(김하늘)을 모임장으로 되돌린다. 찍는 앱도 운영 `.env` 의
 * 관리자 이메일로 기동하는데, 이 DB 에는 그 계정이 없어 관리자는 비어 있게 된다.
 */
async function dressUp(): Promise<void> {
  await withOwnerTx(async (sql) => {
    await sql.query(`UPDATE operator_settings SET operator_user_id = NULL`);
    await sql.query(
      `UPDATE group_admins SET is_owner = false WHERE user_id <> (SELECT id FROM users WHERE email = $1)`,
      [HOST_EMAIL],
    );
    // 처음부터 있던 사람처럼 넣는다 — 채팅은 합류한 뒤의 것만 보이고(0045), 합류
    // 안내 한 줄이 방 맨 아래에 남으면 사진에 그대로 찍힌다.
    await sql.query(
      `INSERT INTO group_admins (group_id, user_id, is_owner, added_by, added_at)
       SELECT g.id, u.id, true, u.id, g.created_at - interval '1 minute'
         FROM groups g, users u WHERE u.email = $1`,
      [HOST_EMAIL],
    );
    await sql.query(`DELETE FROM group_messages WHERE system_kind = 'ADMIN_JOINED'`);
    await sql.query(`UPDATE groups SET name = $1, description = $2`, [
      GROUP_NAME,
      "독서 모임 친구들끼리 서로 소개해 주는 방",
    ]);
    const host = await sql.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [HOST_EMAIL]);
    const hostId = host.rows[0]!.id;
    const second = await sql.query<{ id: string }>(
      `INSERT INTO groups (name, description, created_by) VALUES ('회사 동기 모임', NULL, $1) RETURNING id`,
      [hostId],
    );
    await sql.query(
      `INSERT INTO group_admins (group_id, user_id, is_owner, added_by) VALUES ($1, $2, true, $2)`,
      [second.rows[0]!.id, hostId],
    );
  });
}

async function sessionCookie(email: string): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET 이 필요합니다.");
  const id = await withOwnerTx(async (sql) => {
    const user = await sql.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
    const session = await sql.query<{ id: string }>(
      `INSERT INTO sessions (user_id, expires_at, user_agent)
       VALUES ($1, now() + interval '1 day', 'guide-screenshots') RETURNING id`,
      [user.rows[0]!.id],
    );
    return session.rows[0]!.id;
  });
  return `${id}.${createHmac("sha256", secret).update(id).digest("base64url")}`;
}

function startServer(): ChildProcess {
  const child = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], {
    cwd: path.join(ROOT, "apps", "web"),
    env: { ...guideEnv(), NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  });
  return child;
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${ORIGIN}/api/health`);
      if (response.ok) return;
    } catch {
      // 아직 뜨지 않았다
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${ORIGIN} 가 뜨지 않았습니다.`);
}

// ── API 로 상태 만들기 ───────────────────────────────────────

async function api<T>(
  method: string,
  pathname: string,
  cookie: string,
  body?: unknown,
): Promise<{ data: T; setCookie: string | null }> {
  const response = await fetch(`${ORIGIN}${pathname}`, {
    method,
    headers: {
      cookie: `bolsaram_session=${cookie}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${method} ${pathname} → ${response.status} ${await response.text()}`);
  }
  return { data: (await response.json()) as T, setCookie: response.headers.get("set-cookie") };
}

type ProfileRow = { id: string; code: number; real_name: string; email: string };

async function profiles(): Promise<Map<string, ProfileRow>> {
  const rows = await withOwner((sql) =>
    sql.query<ProfileRow>(
      `SELECT p.id, p.public_code AS code, p.real_name, u.email
         FROM profiles p JOIN users u ON u.id = p.created_by`,
    ),
  );
  return new Map(rows.rows.map((row) => [row.real_name, row]));
}

/** 초대를 발급하고 그 링크로 들어온 멤버의 세션을 돌려준다. */
async function claimMember(hostCookie: string, profileId: string): Promise<string> {
  const invite = await api<{ code: string }>("POST", "/api/admin/invites", hostCookie, {
    profileId,
    expiresInHours: 72,
  });
  const response = await fetch(`${ORIGIN}/api/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: invite.data.code }),
  });
  if (!response.ok) throw new Error(`claim → ${response.status} ${await response.text()}`);
  const match = /bolsaram_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "");
  if (!match) throw new Error("claim 이 세션 쿠키를 주지 않았습니다.");
  return match[1]!;
}

type Fixtures = { hostCookie: string; memberCookie: string; profiles: Map<string, ProfileRow> };

async function buildFixtures(): Promise<Fixtures> {
  const hostCookie = await sessionCookie(HOST_EMAIL);
  const colleagueCookie = await sessionCookie(COLLEAGUE_EMAIL);
  const byName = await profiles();
  const id = (name: string) => byName.get(name)!.id;

  // 멤버 셋이 링크로 들어온다.
  const doyun = await claimMember(hostCookie, id("한도윤"));
  const seoyeon = await claimMember(hostCookie, id("윤서연"));
  const jiwoo = await claimMember(hostCookie, id("김지우"));

  // ① 확인을 기다리는 요청 — 도윤 → 하은
  await api("POST", "/api/match-requests", doyun, { targetProfileId: id("정하은") });

  // ② 신청함 — 서연 → 재현 (주선자가 확인해 전달)
  const sent = await api<{ id: string }>("POST", "/api/match-requests", seoyeon, {
    targetProfileId: id("서재현"),
  });
  await api("POST", `/api/admin/match-intents/${sent.data.id}/approve`, hostCookie, {});

  // ③ 연결됨 — 지우 → 민준, 민준은 휴대폰을 쓰지 않아 주선자가 대신 수락
  const third = await api<{ id: string }>("POST", "/api/match-requests", jiwoo, {
    targetProfileId: id("오민준"),
  });
  await api("POST", `/api/admin/match-intents/${third.data.id}/approve`, hostCookie, {});
  const requestId = await withOwner(async (sql) => {
    const row = await sql.query<{ id: string }>(
      `SELECT id FROM match_requests WHERE requester_profile_id = $1`,
      [id("김지우")],
    );
    return row.rows[0]!.id;
  });
  await api("POST", `/api/admin/match-requests/${requestId}/accept`, hostCookie, {});

  // 모임 채팅
  const groupId = await withOwner(async (sql) => {
    const row = await sql.query<{ id: string }>(`SELECT id FROM groups WHERE name = $1`, [GROUP_NAME]);
    return row.rows[0]!.id;
  });
  const say = (cookie: string, body: string) =>
    api("POST", `/api/admin/groups/${groupId}/messages`, cookie, { body });
  await say(colleagueCookie, "이번 주에 새로 올린 분들 확인해 주세요!");
  await say(hostCookie, `${byName.get("오민준")!.code}번 분 연결됐어요. 주말에 두 분께 연락드릴게요.`);
  await say(colleagueCookie, "좋네요! 저도 내일 두 분 더 올릴게요.");

  return { hostCookie, memberCookie: doyun, profiles: byName };
}

// ── 찍기 ─────────────────────────────────────────────────────

async function contextFor(
  browser: Browser,
  viewport: { width: number; height: number },
  cookie?: string,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    ...(viewport.width < 600 ? { isMobile: true, hasTouch: true } : {}),
  });
  if (cookie) {
    await context.addCookies([
      { name: "bolsaram_session", value: cookie, url: ORIGIN, httpOnly: true, sameSite: "Lax" },
    ]);
  }
  return context;
}

/** 화면 어디서나 떠 있는 채팅 버튼. 본문을 가리는 사진에서는 숨긴다. */
const CHAT_FAB = '[aria-label^="모임 채팅"]';

async function shot(page: Page, name: string, options: { keepFab?: boolean } = {}): Promise<void> {
  if (!options.keepFab) {
    await page.addStyleTag({ content: `${CHAT_FAB} { display: none !important; }` });
  }
  // 커서 깜빡임·전환 애니메이션이 찍히지 않게 잠깐 기다린다.
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.jpg`), type: "jpeg", quality: 82 });
  console.info(`  ${name}.jpg`);
}

/** 제목으로 패널 하나를 골라 그 칸만 찍는다. */
async function shotPanel(
  page: Page,
  title: string,
  name: string,
  beforeShot?: () => Promise<void>,
): Promise<void> {
  const panel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .first();
  await page.addStyleTag({ content: `${CHAT_FAB} { display: none !important; }` });
  await panel.scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await beforeShot?.();
  await panel.screenshot({ path: path.join(OUT_DIR, `${name}.jpg`), type: "jpeg", quality: 85 });
  console.info(`  ${name}.jpg`);
}

/**
 * 이 서버는 127.0.0.1 에서 뜨지만 실제로 멤버가 받는 링크는 공개 도메인이다.
 * 사진에 찍힐 주소만 그렇게 바꿔 적는다.
 */
async function showPublicOrigin(page: Page): Promise<void> {
  await page.evaluate((origin) => {
    for (const input of Array.from(document.querySelectorAll("input"))) {
      if (input.value.startsWith(origin)) {
        input.value = input.value.replace(origin, "https://bolsaram.com");
      }
    }
  }, ORIGIN);
}

async function open(page: Page, pathname: string): Promise<void> {
  await page.goto(`${ORIGIN}${pathname}`, { waitUntil: "networkidle" });
}

async function shoot(browser: Browser, fixtures: Fixtures): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const target = fixtures.profiles.get("정하은")!;

  // 들어오는 문
  {
    const context = await contextFor(browser, PHONE);
    const page = await context.newPage();
    await open(page, "/login");
    await shot(page, "login");
    await open(page, "/enter");
    await shot(page, "enter");
    await context.close();
  }

  // 주선자 화면 (PC)
  {
    const context = await contextFor(browser, DESKTOP, fixtures.hostCookie);
    const page = await context.newPage();

    await open(page, "/home");
    await shot(page, "home", { keepFab: true });

    await page.getByRole("button", { name: /모임 만들기/ }).first().click();
    await page.waitForTimeout(300);
    await shot(page, "group-create");

    await open(page, "/profiles");
    await shot(page, "profiles");

    await open(page, `/profiles/${target.id}`);
    await shot(page, "profile-detail");
    await page.getByRole("button", { name: "초대 링크 발급" }).first().click();
    await page.locator(`input[value^="${ORIGIN}/claim/"]`).waitFor();
    // 발급 직후 화면이 한 번 새로 그려지므로 주소는 찍기 직전에 바꾼다.
    await shotPanel(page, "멤버 화면 열기", "invite", () => showPublicOrigin(page));

    await open(page, "/members");
    await shot(page, "members");

    await open(page, "/requests");
    await shot(page, "requests");

    await open(page, "/account");
    const linkButton = page.getByRole("button", { name: "연결 코드 받기" });
    if (await linkButton.count()) {
      await linkButton.click();
      await page.getByText("이 코드는 다시 볼 수 없습니다").waitFor();
    }
    await shotPanel(page, "텔레그램 연결", "account-telegram");

    await open(page, "/imports");
    await page.locator('input[type="file"]').first().setInputFiles([
      path.join(WORK_DIR, "import", "01.jpg"),
      path.join(WORK_DIR, "import", "02.jpg"),
    ]);
    await page.locator("textarea").first().fill(IMPORT_PERSON.text);
    await page.locator("textarea").first().evaluate((el) => (el.scrollTop = 0));
    await shot(page, "import-new");
    await page.getByRole("button", { name: "AI로 프로필 만들기" }).click();
    await page.waitForURL(/\/imports\/[0-9a-f-]{36}/, { timeout: 60_000 });
    await page.waitForLoadState("networkidle");
    await shot(page, "import-review");

    await open(page, "/chat");
    await shot(page, "chat");

    await context.close();
  }

  // 주선자 화면 (폰)
  {
    const context = await contextFor(browser, PHONE, fixtures.hostCookie);
    const page = await context.newPage();
    await open(page, "/home");
    await shot(page, "home-phone", { keepFab: true });
    await context.close();
  }

  // 멤버가 보는 화면
  {
    const context = await contextFor(browser, PHONE, fixtures.memberCookie);
    const page = await context.newPage();
    await open(page, "/discover");
    await shot(page, "member-discover");
    await context.close();
  }

  await shootTelegram(browser);
}

// ── 텔레그램 대화 그림 ───────────────────────────────────────

type Bubble =
  | { from: "me"; text?: string; photos?: number }
  | { from: "bot"; text: string; buttons?: string[][] };

async function shootTelegram(browser: Browser): Promise<void> {
  // 봇이 실제로 보내는 문구를 그대로 쓴다. server-only 표식 때문에 react-server
  // 조건으로 실행해야 불러올 수 있다(package.json 의 guide:screenshots 참고).
  const { messages } = await import("../apps/web/src/server/telegram/messages");
  const fields = {
    gender: "FEMALE",
    birthYear: 1997,
    height: 163,
    jobTitle: "약사",
    company: "분당 병원",
    education: null,
  } as unknown as Parameters<typeof messages.analyzed>[0];

  const bubbles: Bubble[] = [
    // 실제 연결 코드처럼 생긴 지어낸 값이다.
    { from: "me", text: "/start Qm4vN8xKp2RtLw7bZc9Hs" },
    { from: "bot", text: messages.linked },
    { from: "me", photos: 3 },
    { from: "bot", text: messages.mediaReceiving(GROUP_NAME) },
    { from: "me", text: IMPORT_PERSON.text.split("\n").slice(0, 5).join("\n") + "\n…" },
    { from: "bot", text: messages.textReceived(3) },
    {
      from: "bot",
      text: messages.analyzed(fields, false, GROUP_NAME),
      buttons: [
        [messages.genderButton("MALE", false), messages.genderButton("FEMALE", true)],
        [messages.commitButton, messages.reviewButton],
      ],
    },
  ];

  const looks = [IMPORT_PERSON.look, IMPORT_PERSON.look, PEOPLE[3]!.look];
  const photoUri = (index: number) => {
    const svg = index === 1 ? sceneSvg(looks[index]!) : portraitSvg(looks[index]!);
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  };
  const escape = (text: string) =>
    text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const body = bubbles
    .map((bubble) => {
      if (bubble.from === "me") {
        const photos = bubble.photos
          ? `<div class="photos">${Array.from({ length: bubble.photos })
              .map((_, i) => `<div class="photo" style="background-image:url('${photoUri(i)}')"></div>`)
              .join("")}</div>`
          : "";
        const text = bubble.text ? `<div class="text">${escape(bubble.text)}</div>` : "";
        return `<div class="row me"><div class="bubble me">${photos}${text}</div></div>`;
      }
      const buttons = (bubble.buttons ?? [])
        .map((row) => `<div class="keys">${row.map((label) => `<span>${escape(label)}</span>`).join("")}</div>`)
        .join("");
      return `<div class="row bot"><div><div class="bubble bot"><div class="text">${escape(bubble.text)}</div></div>${buttons}</div></div>`;
    })
    .join("");

  const css = `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: var(--font-clean-sans), sans-serif; background: #c9d8c0; color: #1d2329; }
    header { position: sticky; top: 0; display: flex; gap: 10px; align-items: center; padding: 12px 16px; background: #fff; border-bottom: 1px solid #e3e3e3; }
    header .avatar { width: 38px; height: 38px; border-radius: 50%; background: #b0545f; color: #fff; display: grid; place-items: center; font-weight: 700; }
    header b { display: block; font-size: 15px; }
    header small { color: #7b8a96; font-size: 12px; }
    main { padding: 14px 10px 24px; background: linear-gradient(#cfdcc6, #b8cdb0); }
    .row { display: flex; margin: 6px 0; }
    .row.me { justify-content: flex-end; }
    .bubble { max-width: 300px; padding: 8px 11px; border-radius: 14px; font-size: 13.5px; line-height: 1.45; box-shadow: 0 1px 1px rgba(0,0,0,.08); }
    .bubble.me { background: #e2f7cb; border-bottom-right-radius: 4px; }
    .bubble.bot { background: #fff; border-bottom-left-radius: 4px; }
    .text { white-space: pre-wrap; word-break: keep-all; }
    .photos { display: grid; grid-template-columns: repeat(3, 72px); gap: 3px; margin-bottom: 2px; }
    .photo { height: 96px; border-radius: 8px; background-size: cover; background-position: center; }
    .keys { display: flex; gap: 4px; margin-top: 4px; max-width: 300px; }
    .keys span { flex: 1; text-align: center; padding: 8px 4px; border-radius: 9px; background: rgba(255,255,255,.55); color: #2d5b3f; font-size: 13px; font-weight: 600; }
  `;
  const html = `<header><div class="avatar">볼</div><div><b>볼사람 봇</b><small>bot</small></div></header>
    <main>${body}</main>`;

  // 호스트에 한글 시스템 폰트가 없을 수 있다. 앱 페이지를 연 뒤 본문만 바꿔 끼워
  // 앱이 내려주는 웹폰트(--font-clean-sans)로 그린다.
  const page = await browser.newPage({ viewport: { width: 390, height: 600 }, deviceScaleFactor: 2 });
  await open(page, "/privacy");
  await page.evaluate(
    ({ css, html }) => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.append(style);
      document.body.className = "";
      document.body.innerHTML = html;
    },
    { css, html },
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, "telegram-bot.jpg"), type: "jpeg", quality: 85, fullPage: true });
  console.info("  telegram-bot.jpg");
  await page.close();
}

// ── 실행 ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadDotEnv();
  const libs = process.env.GUIDE_CHROMIUM_LIBS;
  const fonts = process.env.GUIDE_CHROMIUM_FONTS;
  const browser = await chromium.launch({
    headless: true,
    // 파일 고르기 버튼처럼 브라우저가 그리는 글자도 한국어로 나오게 한다.
    args: ["--lang=ko-KR"],
    env: {
      ...process.env,
      LANGUAGE: "ko",
      ...(libs ? { LD_LIBRARY_PATH: libs } : {}),
      // select·파일 버튼은 웹폰트가 아니라 시스템 폰트로 그린다. 한글 폰트가 없는
      // 호스트에서는 풀어 둔 폰트의 fontconfig 설정을 넘긴다.
      ...(fonts ? { FONTCONFIG_FILE: fonts } : {}),
    },
  });

  let server: ChildProcess | null = null;
  try {
    await mkdir(WORK_DIR, { recursive: true });
    console.info("가이드 DB 준비");
    await recreateDatabase();
    const sampleDir = await writeSamples(browser);

    // 여기부터는 가이드 DB 에 붙는다.
    process.env.DATABASE_URL = guideEnv().DATABASE_URL;
    process.env.APP_DATABASE_URL = guideEnv().APP_DATABASE_URL;
    await createHosts();
    seed(sampleDir);
    await dressUp();

    console.info(`앱 기동 (${ORIGIN})`);
    server = startServer();
    await waitForServer();

    const fixtures = await buildFixtures();
    console.info(`찍기 → ${path.relative(ROOT, OUT_DIR)}`);
    await shoot(browser, fixtures);
  } finally {
    await browser.close();
    if (server?.pid) process.kill(-server.pid, "SIGTERM");
    await closePools();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
