/**
 * 업데이트 소식 주간 작성.
 *
 * 지난주(월~일) 커밋과 사용자 가이드 변경분을 읽어 OpenAI 로 멤버·주선자가 읽을 항목을 쓰고,
 * `docs/guide/updates.md` 에 **바로 싣는다**. `/updates` 화면은 요청마다 파일을 읽으므로
 * 빌드 없이 반영된다. 고칠 것이 있으면 문서를 직접 고친다 — 이미 있는 주에는 새 항목만
 * 덧붙이므로 손으로 고친 문장은 지워지지 않는다.
 *
 * 거름은 세 겹이다. 먼저 커밋마다 「알아챌 변경인가」를 Decisions API 로 따로 판정해
 * 내부 작업으로 보이는 커밋에 표시를 단다(빼지는 않는다 — `markInternalCommits`). 프롬프트가
 * 내부 작업을 빼라고 하고, 응답은 Zod 로 검증한 뒤 `keepItem` 이 코드 이름·내부 용어가 섞인
 * 항목을 버린다. 실린 항목은 `OPS_TELEGRAM_CHAT_ID` 로 알린다.
 *
 * 모델에는 커밋 메시지와 가이드 문서 변경분만 보낸다 — 둘 다 개발자가 쓴 글이고 멤버
 * 정보는 들어 있지 않다. DB 에는 붙지 않는다.
 *
 *   pnpm updates:weekly                      지난주를 쓴다 (PM2 `bolsaram-updates` 가 월요일 09:00 에 돈다)
 *   pnpm updates:weekly --date 2026-10-14    그날이 속한 주를 쓴다
 *   pnpm updates:weekly --dry-run            쓰지 않고 결과만 보여준다 (알림 없음)
 *   pnpm updates:weekly --no-notify          쓰되 알리지 않는다
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import path from "node:path";
import {
  commitPredicateAnswerSchema,
  commitVisibilityResponseSchema,
  updateItemsJsonSchema,
  updateItemsSchema,
  UPDATE_ITEMS_MAX,
} from "@bolsaram/schemas";
import { loadDotEnv } from "../packages/db/src/cli/dotenv";
import {
  INTERNAL_COMMIT_MARK,
  addWeekItems,
  keepItem,
  markInternalCommits,
  nothingToAnnounce,
  weekHeading,
  weekItems,
  weekOf,
  type Week,
} from "./updates-doc";

// 해외 API 는 TCP 연결이 250ms(Node 기본값)를 넘어 완료 직전에 취소된다.
setDefaultAutoSelectFamilyAttemptTimeout(2_000);

loadDotEnv();

const ROOT = path.resolve(import.meta.dirname, "..");
const DOC = path.join(ROOT, "docs", "guide", "updates.md");
const TIMEOUT_MS = 120_000;
/** 프롬프트에 넣는 가이드 변경분 상한. 넘치면 앞부분만 싣는다. */
const GUIDE_DIFF_MAX_CHARS = 14_000;
const COMMIT_BODY_MAX_CHARS = 600;

/**
 * 사용자가 알아챌 수 없는 영역만 건드린 커밋은 빼고 읽는다. 업데이트 문서 자체도 뺀다 —
 * 지난 소식을 고친 커밋이 새 소식으로 다시 쓰이면 안 된다.
 */
const EXCLUDED_PATHS = [
  "tests/",
  ".agent-config/",
  ".ai-harness/",
  ".claude/",
  ".codex/",
  "docs/guide/updates.md",
];

const SYSTEM_PROMPT = `너는 소개팅 서비스 「볼사람」의 업데이트 소식을 쓴다.
읽는 사람은 볼사람을 쓰는 주선자(프로필을 등록하고 사람을 잇는 사람)와 멤버(소개를 받는 사람)다.

입력: 한 주 동안의 커밋 메시지와, 같은 기간 사용자 가이드 문서에 더해진 줄.
가이드 문서는 실제 화면 동작의 설명이다. 커밋 메시지와 어긋나면 가이드를 따른다.

쓰는 규칙:
- 한국어 '합니다' 체. 항목마다 1~2문장. 무엇이 생겼거나 바뀌었고 쓰는 사람에게 무엇이 좋아졌는지 쓴다.
- 화면 이름·버튼 이름은 **굵게** 감싼다. 그 밖의 마크다운(링크·코드·제목·중첩 목록)은 쓰지 않는다.
- 화면에서 알아챌 수 있는 변경만 쓴다. 테스트·하네스·배포·서버·데이터베이스·문서 정리·리팩터링 같은 내부 작업은 쓰지 않는다.
- 코드 용어를 쓰지 않는다: 파일명·함수명·변수명·테이블명·경로·커밋 해시·라이브러리 이름·영어 개발 용어.
- 같은 주 안에서 만들었다가 되돌린 것은 쓰지 않는다.
- 입력에 없는 내용을 지어내지 않는다. 과장·홍보 문구·이모지를 쓰지 않는다.
- 사람 이름이나 개인 정보를 쓰지 않는다.
- 항목은 0~${UPDATE_ITEMS_MAX}개. 작은 변경은 묶는다. 알릴 변경이 없으면 빈 목록을 낸다.
- [이미 실린 항목]과 같은 내용은 다시 쓰지 않는다. 그 목록에 없는 새 변경만 낸다.
- ${INTERNAL_COMMIT_MARK} 가 붙은 커밋은 [사용자 가이드에 더해진 줄]이 같은 변경을 설명할 때만 쓴다.`;

type Options = { week: Week; dryRun: boolean; notify: boolean };

function parseArgs(argv: string[]): Options {
  let day: Date | null = null;
  let dryRun = false;
  let notify = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--no-notify") notify = false;
    else if (arg === "--date") {
      const value = argv[++i] ?? "";
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (!match) throw new Error(`--date 는 YYYY-MM-DD 형식입니다: ${value}`);
      day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    } else {
      throw new Error(`알 수 없는 인자: ${arg}`);
    }
  }
  if (!day) {
    day = new Date();
    day.setDate(day.getDate() - 7);
  }
  if (day.getTime() > Date.now()) throw new Error("아직 오지 않은 날입니다.");
  return { week: weekOf(day), dryRun, notify: notify && !dryRun };
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function windowArgs({ monday, nextMonday }: Week): string[] {
  // 로컬 시각 그대로 넘긴다 — git 이 호스트 시간대로 해석한다.
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} 00:00:00`;
  return ["--no-merges", `--since=${fmt(monday)}`, `--until=${fmt(nextMonday)}`];
}

function readCommits(week: Week): string[] {
  const out = git([
    "log",
    ...windowArgs(week),
    "--date=format:%m/%d",
    "--pretty=format:%x1e%ad%x1f%s%x1f%b",
    "--",
    ".",
    ...EXCLUDED_PATHS.map((p) => `:(exclude)${p}`),
  ]);
  return out
    .split("\x1e")
    .filter((record) => record.trim())
    .reverse()
    .map((record) => {
      const [when = "", subject = "", body = ""] = record.split("\x1f");
      const trimmed = body.trim().slice(0, COMMIT_BODY_MAX_CHARS);
      return `- [${when.trim()}] ${subject.trim()}${trimmed ? `\n  ${trimmed.replace(/\n/g, "\n  ")}` : ""}`;
    });
}

/** 그 주에 가이드 문서에 더해진 줄. 지운 줄은 싣지 않는다 — 지금 동작의 근거가 아니다. */
function readGuideAdditions(week: Week): string {
  const out = git([
    "log",
    ...windowArgs(week),
    "--reverse",
    "-p",
    "--format=",
    "--",
    "docs/guide",
    ":(exclude)docs/guide/updates.md",
  ]);
  const added = out
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .filter((line) => line.trim() && !line.startsWith("!["))
    .join("\n");
  return added.length > GUIDE_DIFF_MAX_CHARS ? `${added.slice(0, GUIDE_DIFF_MAX_CHARS)}\n(이하 생략)` : added;
}

async function writeItems(input: string): Promise<string[]> {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!key || !model) throw new Error("OPENAI_API_KEY 와 OPENAI_MODEL 이 필요합니다.");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: input },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "bolsaram_weekly_updates", strict: true, schema: updateItemsJsonSchema },
      },
      // GPT-5.6 계열은 temperature 를 받지 않는다(.env.example 참고).
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // 키가 섞일 수 있는 본문은 남기지 않는다.
  if (!response.ok) throw new Error(`AI 요청이 거절되었습니다 (HTTP ${response.status}).`);

  const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) throw new Error("AI 응답이 비어 있습니다.");
  const validated = updateItemsSchema.safeParse(JSON.parse(raw));
  if (!validated.success) throw new Error("AI 응답이 스키마와 맞지 않습니다.");
  return validated.data.items;
}

/** Decisions API 한 번에 묻는 질문 상한(API 가 받는 1..200). */
const DECISIONS_MAX_QUESTIONS = 200;

/**
 * 커밋마다 「멤버·주선자가 알아챌 변경인가」의 확률. 표시를 달 근거일 뿐이라 실패하면
 * null 을 돌려주고 표시 없이 쓴다(AI_DECISIONS=off 도 같다).
 */
async function judgeCommits(commits: string[]): Promise<(number | null)[] | null> {
  const key = process.env.OPENAI_API_KEY;
  if (process.env.AI_DECISIONS === "off" || !key) return null;
  const model = process.env.OPENAI_DECISIONS_MODEL || "gpt-6-luna";
  const result: (number | null)[] = commits.map(() => null);
  try {
    for (let start = 0; start < commits.length; start += DECISIONS_MAX_QUESTIONS) {
      const batch = commits.slice(start, start + DECISIONS_MAX_QUESTIONS);
      const response = await fetch("https://api.openai.com/v1/decisions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          input: batch.map((line, i) => `[커밋 ${i + 1}] ${line.replace(/^- /, "")}`).join("\n\n"),
          questions: batch.map((_, i) => ({
            type: "predicate",
            name: `c${i + 1}`,
            instructions:
              `[커밋 ${i + 1}] 이 소개팅 서비스를 쓰는 멤버나 주선자가 화면·봇·알림에서 알아챌 수 있는 변경을 담고 있다. ` +
              "테스트·하네스·배포·서버 내부·데이터베이스 구조·문서 정리·리팩터링만 바꾼 커밋이면 거짓이다.",
          })),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const validated = commitVisibilityResponseSchema.safeParse(await response.json());
      if (!validated.success) throw new Error("응답 형식이 맞지 않습니다");
      for (const raw of validated.data.answers) {
        const answer = commitPredicateAnswerSchema.safeParse(raw);
        if (!answer.success) continue;
        const index = Number(answer.data.name.slice(1)) - 1;
        if (index < batch.length) result[start + index] = answer.data.probability;
      }
    }
    return result;
  } catch (error) {
    console.warn(`커밋 판정을 건너뜁니다 — 표시 없이 씁니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
    return null;
  }
}

async function notify(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.OPS_TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("알림을 보낼 곳이 없습니다 — OPS_TELEGRAM_CHAT_ID 와 TELEGRAM_BOT_TOKEN 이 필요합니다.");
    return;
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(15_000),
    });
    // 토큰이 URL 에 있으므로 URL 이나 원본 오류를 싣지 않는다.
    if (!response.ok) console.error(`알림 전송 실패 (HTTP ${response.status})`);
  } catch (error) {
    console.error(`알림 전송 실패: ${error instanceof Error ? error.name : "알 수 없는 오류"}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const heading = weekHeading(options.week);

  const commits = readCommits(options.week);
  if (commits.length === 0) {
    console.info(`${heading}: 읽을 커밋이 없습니다 — 그대로 둡니다.`);
    return;
  }

  const doc = readFileSync(DOC, "utf8");
  const existing = weekItems(doc, heading);
  const guide = readGuideAdditions(options.week);
  const judged = await judgeCommits(commits);
  const marked = markInternalCommits(commits, judged ?? []);
  if (judged) console.info(`${heading}: 커밋 ${commits.length}개 중 내부 작업으로 보이는 것 ${marked.internal}개`);
  if (nothingToAnnounce(commits.length, marked.internal, guide)) {
    console.info(`${heading}: 알릴 변경이 없습니다 — 그대로 둡니다.`);
    return;
  }
  const input = [
    `[기간] ${heading}`,
    `[커밋 메시지]\n${marked.lines.join("\n")}`,
    `[사용자 가이드에 더해진 줄]\n${guide || "(없음)"}`,
    `[이미 실린 항목]\n${existing.map((item) => `- ${item}`).join("\n") || "(없음)"}`,
  ].join("\n\n");

  const items = await writeItems(input);
  const kept = items.filter((item) => keepItem(item) && !existing.includes(item));
  console.info(`${heading}: 커밋 ${commits.length}개 → 항목 ${items.length}개, 실을 것 ${kept.length}개`);
  if (kept.length < items.length) {
    console.info(`  거른 항목 ${items.length - kept.length}개(내부 용어·코드 이름·중복)`);
  }

  if (options.dryRun) {
    for (const item of kept) console.info(`- ${item}`);
    return;
  }
  if (kept.length === 0) return;

  writeFileSync(DOC, addWeekItems(doc, heading, kept), "utf8");
  console.info(`✓ ${path.relative(ROOT, DOC)} 에 실었습니다.`);
  if (options.notify) {
    await notify(
      [
        `볼사람 업데이트 소식 — ${heading} 에 ${kept.length}개를 실었습니다.`,
        "",
        ...kept.map((item) => `• ${item.replace(/\*\*/g, "")}`),
        "",
        "고칠 것이 있으면 docs/guide/updates.md 를 직접 고치세요.",
      ].join("\n"),
    );
  }
}

main().catch(async (error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`✗ 업데이트 소식을 쓰지 못했습니다: ${reason}`);
  if (!process.argv.includes("--dry-run") && !process.argv.includes("--no-notify")) {
    await notify(`볼사람 업데이트 소식을 쓰지 못했습니다: ${reason}`);
  }
  process.exit(1);
});
