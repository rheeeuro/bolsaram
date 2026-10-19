/**
 * 업데이트 소식 문서(`docs/guide/updates.md`)를 다루는 순수 함수.
 *
 * 주간 작업(`updates-weekly.ts`)이 쓰고 `tests/updates-weekly.test.ts` 가 검사한다.
 * 파일·git·네트워크를 만지지 않는다.
 *
 * 문서 형태: 첫 `##` 앞은 머리말, `## 2026년 10월 12일 ~ 18일` 하나가 월~일 한 주,
 * 최근 주가 위, 본문은 `- ` 목록뿐이다.
 */

export type Week = { monday: Date; nextMonday: Date };

/** `day` 가 속한 주(월요일 0시 ~ 다음 월요일 0시, 로컬 시각). */
export function weekOf(day: Date): Week {
  const monday = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  return { monday, nextMonday };
}

/** 문서의 주 제목. 달·해가 바뀌는 주는 끝 날짜에 달·해를 붙인다. */
export function weekHeading({ monday }: Week): string {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const start = `${monday.getFullYear()}년 ${monday.getMonth() + 1}월 ${monday.getDate()}일`;
  let end = `${sunday.getDate()}일`;
  if (sunday.getMonth() !== monday.getMonth()) end = `${sunday.getMonth() + 1}월 ${end}`;
  if (sunday.getFullYear() !== monday.getFullYear()) end = `${sunday.getFullYear()}년 ${end}`;
  return `${start} ~ ${end}`;
}

const HEADING_START = /^(\d{4})년 (\d{1,2})월 (\d{1,2})일 ~ /;

/** 주 제목의 시작일. 형식이 다르면 null. */
export function headingStart(heading: string): Date | null {
  const match = HEADING_START.exec(heading);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

type Section = { heading: string; lines: string[] };
type Doc = { intro: string[]; sections: Section[] };

function parse(markdown: string): Doc {
  const doc: Doc = { intro: [], sections: [] };
  for (const line of markdown.replace(/\s+$/, "").split("\n")) {
    if (line.startsWith("## ")) {
      doc.sections.push({ heading: line.slice(3).trim(), lines: [] });
    } else if (doc.sections.length > 0) {
      doc.sections[doc.sections.length - 1]!.lines.push(line);
    } else {
      doc.intro.push(line);
    }
  }
  return doc;
}

function trimBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === "") start++;
  while (end > start && lines[end - 1]!.trim() === "") end--;
  return lines.slice(start, end);
}

function serialize(doc: Doc): string {
  const parts = [trimBlank(doc.intro).join("\n")];
  for (const section of doc.sections) {
    parts.push([`## ${section.heading}`, "", ...trimBlank(section.lines)].join("\n"));
  }
  return `${parts.join("\n\n")}\n`;
}

/** 그 주에 이미 실린 항목(`- ` 뒤 문장). */
export function weekItems(markdown: string, heading: string): string[] {
  const section = parse(markdown).sections.find((s) => s.heading === heading);
  if (!section) return [];
  return section.lines.filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
}

/**
 * 그 주에 항목을 더한다. 주가 있으면 끝에 덧붙이고(이미 있는 문장은 건너뛴다), 없으면
 * 날짜 순서에 맞는 자리에 새로 만든다. 더할 것이 없으면 문서를 그대로 돌려준다.
 */
export function addWeekItems(markdown: string, heading: string, items: string[]): string {
  const start = headingStart(heading);
  if (!start) throw new Error(`주 제목 형식이 아닙니다: ${heading}`);
  const existing = new Set(weekItems(markdown, heading));
  const fresh = items.filter((item) => !existing.has(item));
  if (fresh.length === 0) return markdown;

  const doc = parse(markdown);
  const bullets = fresh.map((item) => `- ${item}`);
  const section = doc.sections.find((s) => s.heading === heading);
  if (section) {
    section.lines = [...trimBlank(section.lines), ...bullets];
  } else {
    const at = doc.sections.findIndex((s) => (headingStart(s.heading)?.getTime() ?? 0) < start.getTime());
    doc.sections.splice(at < 0 ? doc.sections.length : at, 0, { heading, lines: bullets });
  }
  return serialize(doc);
}

/**
 * 프롬프트를 믿지 않고 한 번 더 거른다 — 멤버와 주선자가 읽는 문서라 내부 작업이나
 * 코드 이름이 새면 안 된다. 걸리는 항목은 통째로 버린다(고쳐 쓰지 않는다).
 */
const BANNED_WORDS = [
  "마이그레이션", "테스트", "하네스", "에이전트", "리팩터", "커밋", "배포", "빌드", "훅",
  "서버", "데이터베이스", "스키마", "트리거", "시드", "엔드포인트", "프롬프트",
  "RLS", "DB", "API", "PM2", "SQL", "Codex", "Claude", "TODO",
];
const CODE_LIKE = [
  /`/, // 인라인 코드
  /\.(tsx?|md|sql|json|sh|py|cjs|mjs)\b/i, // 파일명
  /[a-z][A-Z]/, // camelCase
  /\b[a-z]+_[a-z_]+\b/, // snake_case
  /\b[0-9a-f]{7,40}\b/, // 커밋 해시
];

export function keepItem(text: string): boolean {
  if (BANNED_WORDS.some((word) => text.includes(word))) return false;
  return !CODE_LIKE.some((pattern) => pattern.test(text));
}

/**
 * 커밋마다 「멤버·주선자가 알아챌 변경인가」를 따로 판정한 확률(Decisions API)로
 * 내부 작업으로 보이는 커밋에 표시를 단다. **빼지 않는다** — 화면이 생긴 커밋도 메시지가
 * 문서·테스트 위주면 낮게 나온다(「Add start guide」 0.06, 실측). 쓰기 모델이 표시를 보고
 * 가이드 변경분과 견줘 고른다.
 */
export const INTERNAL_COMMIT_THRESHOLD = 0.5;
export const INTERNAL_COMMIT_MARK = "(내부 작업으로 보임)";

/** 판정이 없는 커밋(`null`)은 표시하지 않는다. 커밋 줄은 `- [날짜] 제목` 모양이다. */
export function markInternalCommits(
  commits: readonly string[],
  probabilities: readonly (number | null)[],
): { lines: string[]; internal: number } {
  let internal = 0;
  const lines = commits.map((line, i) => {
    const p = probabilities[i];
    if (p == null || p >= INTERNAL_COMMIT_THRESHOLD) return line;
    internal += 1;
    return line.replace(/^(- \[[^\]]*\] )/, `$1${INTERNAL_COMMIT_MARK} `);
  });
  return { lines, internal };
}

/** 모든 커밋이 내부 작업으로 보이고 가이드에 더해진 줄도 없으면 쓸 것이 없다(모델을 부르지 않는다). */
export function nothingToAnnounce(commitCount: number, internal: number, guide: string): boolean {
  return commitCount > 0 && internal === commitCount && guide.trim().length === 0;
}
