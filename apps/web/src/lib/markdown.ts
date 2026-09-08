/**
 * 가이드 문서용 마크다운 부분집합 파서.
 *
 * `docs/guide/` 의 마크다운이 사용자 문서의 단일 원본이다. 화면에서 같은 내용을
 * 보여주려면 렌더러가 필요한데, 이 문서들이 쓰는 문법은 좁다 — 제목·문단·강조·
 * 인라인 코드·인용·표·목록·구분선. 그래서 의존성을 더하지 않고 여기서 처리한다.
 *
 * 판정은 **블록 배열까지만** 한다. JSX 는 `components/ui/markdown.tsx` 가 만든다 —
 * 그래서 테스트가 렌더링 없이 문서 전체를 훑어 놓친 문법을 잡을 수 있다.
 *
 * 지원하지 않는 문법(링크·이미지·중첩 목록·코드 블록)은 **문단 텍스트로 그대로**
 * 남는다. 조용히 사라지지 않게 하려고 이렇게 뒀고, 문서가 그것을 쓰지 않는지는
 * `tests/markdown.test.ts` 가 지킨다.
 */

export type InlineSpan =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "code"; text: string };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; spans: InlineSpan[] }
  | { kind: "paragraph"; spans: InlineSpan[] }
  | { kind: "quote"; paragraphs: InlineSpan[][] }
  | { kind: "list"; ordered: boolean; items: InlineSpan[][] }
  | { kind: "table"; head: InlineSpan[][]; rows: InlineSpan[][][] }
  | { kind: "rule" };

const HEADING = /^(#{1,3})\s+(.*)$/;
const RULE = /^-{3,}$/;
const QUOTE = /^>\s?(.*)$/;
const BULLET = /^[-*]\s+(.+)$/;
const ORDERED = /^\d+\.\s+(.+)$/;
/** 목록 항목의 이어지는 줄. 마크다운처럼 들여쓰기로 판단한다. */
const CONTINUATION = /^\s{2,}(\S.*)$/;
const TABLE_ROW = /^\|(.*)\|$/;
/** `|---|:--:|` 형태의 표 구분선. */
const TABLE_DIVIDER = /^\|[\s:|-]+\|$/;

/** 인라인 강조와 코드. 코드 안의 `**` 는 강조로 보지 않도록 한 번에 훑는다. */
const INLINE = /`([^`]+)`|\*\*([^*]+?)\*\*/g;

export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index;
    if (start > at) spans.push({ kind: "text", text: text.slice(at, start) });
    if (match[1] != null) spans.push({ kind: "code", text: match[1] });
    else if (match[2] != null) spans.push({ kind: "strong", text: match[2] });
    at = start + match[0].length;
  }
  if (at < text.length) spans.push({ kind: "text", text: text.slice(at) });
  return spans;
}

/** 소프트 줄바꿈은 마크다운과 같이 공백 하나로 잇는다. */
function joinLines(lines: string[]): string {
  return lines.join(" ").trim();
}

function cells(row: string): string[] {
  const inner = TABLE_ROW.exec(row)?.[1] ?? row;
  return inner.split("|").map((cell) => cell.trim());
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n").map((line) => line.trimEnd());
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim().length === 0) {
      i += 1;
      continue;
    }

    if (RULE.test(line.trim())) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, spans: parseInline(heading[2]!.trim()) });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const paragraphs: InlineSpan[][] = [];
      let buffer: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        const content = QUOTE.exec(lines[i]!)![1]!;
        if (content.trim().length === 0) {
          if (buffer.length > 0) paragraphs.push(parseInline(joinLines(buffer)));
          buffer = [];
        } else {
          buffer.push(content.trim());
        }
        i += 1;
      }
      if (buffer.length > 0) paragraphs.push(parseInline(joinLines(buffer)));
      blocks.push({ kind: "quote", paragraphs });
      continue;
    }

    // 표는 구분선이 있어야 표다. 없으면 `|` 로 시작하는 평범한 문단으로 둔다.
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1]!)) {
      const head = cells(line).map(parseInline);
      i += 2;
      const rows: InlineSpan[][][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) {
        rows.push(cells(lines[i]!).map(parseInline));
        i += 1;
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      const isOrdered = ordered != null && bullet == null;
      const items: string[][] = [];
      while (i < lines.length) {
        const current = lines[i]!;
        const nextBullet = isOrdered ? ORDERED.exec(current) : BULLET.exec(current);
        if (nextBullet) {
          items.push([nextBullet[1]!.trim()]);
          i += 1;
          continue;
        }
        const cont = CONTINUATION.exec(current);
        if (cont && items.length > 0) {
          items[items.length - 1]!.push(cont[1]!.trim());
          i += 1;
          continue;
        }
        break;
      }
      blocks.push({
        kind: "list",
        ordered: isOrdered,
        items: items.map((item) => parseInline(joinLines(item))),
      });
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = lines[i]!;
      if (current.trim().length === 0) break;
      if (RULE.test(current.trim()) || HEADING.test(current) || QUOTE.test(current)) break;
      if (BULLET.test(current) || ORDERED.test(current) || TABLE_ROW.test(current)) break;
      paragraph.push(current.trim());
      i += 1;
    }
    blocks.push({ kind: "paragraph", spans: parseInline(joinLines(paragraph)) });
  }

  return blocks;
}

/** 블록에 담긴 글자만 이어붙인다. 테스트와 요약에서 쓴다. */
export function blockText(block: Block): string {
  const fromSpans = (spans: InlineSpan[]) => spans.map((span) => span.text).join("");
  switch (block.kind) {
    case "heading":
    case "paragraph":
      return fromSpans(block.spans);
    case "quote":
      return block.paragraphs.map(fromSpans).join(" ");
    case "list":
      return block.items.map(fromSpans).join(" ");
    case "table":
      return [block.head, ...block.rows].map((row) => row.map(fromSpans).join(" ")).join(" ");
    case "rule":
      return "";
  }
}
