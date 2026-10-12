/**
 * 가이드 마크다운 파서.
 *
 * `/privacy` 화면은 `docs/guide/privacy.md` 를 그대로 보여준다. 문서가 파서가 모르는
 * 문법을 쓰기 시작하면 화면에서 **조용히 이상하게** 나온다 — 그것을 여기서 잡는다.
 *
 * 문장과 표현은 검사하지 않는다. 구조만 본다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blockText, parseInline, parseMarkdown } from "../apps/web/src/lib/markdown";

const PRIVACY = readFileSync(
  path.join(import.meta.dirname, "..", "docs", "guide", "privacy.md"),
  "utf8",
);
const START = readFileSync(
  path.join(import.meta.dirname, "..", "docs", "guide", "start.md"),
  "utf8",
);

describe("블록 판정", () => {
  it("제목 세 단계를 읽는다", () => {
    const blocks = parseMarkdown("# 하나\n\n## 둘\n\n### 셋");
    expect(blocks).toEqual([
      { kind: "heading", level: 1, spans: [{ kind: "text", text: "하나" }] },
      { kind: "heading", level: 2, spans: [{ kind: "text", text: "둘" }] },
      { kind: "heading", level: 3, spans: [{ kind: "text", text: "셋" }] },
    ]);
  });

  it("소프트 줄바꿈은 공백 하나로 잇는다", () => {
    const [block] = parseMarkdown("앞 문장\n뒤 문장");
    expect(blockText(block!)).toBe("앞 문장 뒤 문장");
  });

  it("빈 줄로 문단을 나눈다", () => {
    expect(parseMarkdown("하나\n\n둘").map((b) => b.kind)).toEqual(["paragraph", "paragraph"]);
  });

  it("구분선을 문단으로 삼키지 않는다", () => {
    expect(parseMarkdown("글\n\n---\n\n글").map((b) => b.kind)).toEqual([
      "paragraph",
      "rule",
      "paragraph",
    ]);
  });

  it("인용은 여러 줄을 한 덩어리로 묶는다", () => {
    const [block] = parseMarkdown("> 첫 줄\n> 이어지는 줄\n>\n> 다음 문단");
    expect(block).toEqual({
      kind: "quote",
      paragraphs: [
        [{ kind: "text", text: "첫 줄 이어지는 줄" }],
        [{ kind: "text", text: "다음 문단" }],
      ],
    });
  });

  it("표를 머리와 본문으로 나눈다", () => {
    const [block] = parseMarkdown("| 가 | 나 |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |");
    expect(block?.kind).toBe("table");
    expect(blockText(block!)).toBe("가 나 1 2 3 4");
  });

  it("구분선이 없으면 표로 보지 않는다", () => {
    // `|` 로 시작하는 평범한 문장을 표로 오해하면 본문이 통째로 사라진다.
    expect(parseMarkdown("| 표 아닌 줄").map((b) => b.kind)).toEqual(["paragraph"]);
  });

  it("순서 없는 목록과 순서 있는 목록을 구분한다", () => {
    expect(parseMarkdown("- 하나\n- 둘")).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [[{ kind: "text", text: "하나" }], [{ kind: "text", text: "둘" }]],
      },
    ]);
    const [ordered] = parseMarkdown("1. 하나\n2. 둘");
    expect(ordered).toMatchObject({ kind: "list", ordered: true });
  });

  it("목록 항목의 이어지는 줄을 같은 항목에 붙인다", () => {
    const [block] = parseMarkdown("- 앞\n  뒤\n- 다음");
    expect(block).toMatchObject({ kind: "list", items: [[{ text: "앞 뒤" }], [{ text: "다음" }]] });
  });
});

describe("이미지 판정", () => {
  it("한 줄짜리 이미지를 블록으로 읽는다", () => {
    expect(parseMarkdown("![홈 화면](/guide/home.jpg)")).toEqual([
      { kind: "image", alt: "홈 화면", src: "/guide/home.jpg", frame: "desktop" },
    ]);
  });

  it("따옴표 안의 값으로 사진 틀을 고른다", () => {
    expect(parseMarkdown('![폰](/guide/a.jpg "phone")')[0]).toMatchObject({ frame: "phone" });
    expect(parseMarkdown('![칸](/guide/a.jpg "panel")')[0]).toMatchObject({ frame: "panel" });
  });

  it("문단 바로 다음 줄의 이미지를 문단에 삼키지 않는다", () => {
    expect(parseMarkdown("설명\n![사진](/guide/a.jpg)").map((b) => b.kind)).toEqual([
      "paragraph",
      "image",
    ]);
  });

  it("앱 밖 주소나 경로 탈출은 이미지로 보지 않는다", () => {
    // 문서가 외부 이미지를 끌어오거나 다른 정적 파일을 가리키지 못하게 한다.
    for (const line of [
      "![x](https://example.com/a.jpg)",
      "![x](/guide/../favicon.ico)",
      "![x](/bolsaram-logo-primary.png)",
      "![x](/guide/a.svg)",
    ]) {
      expect(parseMarkdown(line).map((b) => b.kind), line).toEqual(["paragraph"]);
    }
  });
});

describe("인라인 판정", () => {
  it("강조를 뽑아낸다", () => {
    expect(parseInline("보통 **강조** 보통")).toEqual([
      { kind: "text", text: "보통 " },
      { kind: "strong", text: "강조" },
      { kind: "text", text: " 보통" },
    ]);
  });

  it("코드 안의 별표는 강조가 아니다", () => {
    expect(parseInline("`**그대로**`")).toEqual([{ kind: "code", text: "**그대로**" }]);
  });

  it("짝이 맞지 않는 별표는 글자로 남긴다", () => {
    expect(parseInline("**열고 안 닫음")).toEqual([{ kind: "text", text: "**열고 안 닫음" }]);
  });

  it("표시 문자를 남기지 않는다", () => {
    const spans = parseInline("**강조**와 `코드`");
    expect(spans.map((s) => s.text).join("")).toBe("강조와 코드");
  });
});

describe("처리방침 문서를 화면에 낼 수 있다", () => {
  const blocks = parseMarkdown(PRIVACY);

  it("제목으로 시작한다", () => {
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
  });

  it("표·인용·목록이 모두 인식된다", () => {
    const kinds = new Set(blocks.map((b) => b.kind));
    for (const kind of ["heading", "paragraph", "quote", "list", "table", "rule"]) {
      expect(kinds.has(kind as never), `${kind} 블록이 없습니다`).toBe(true);
    }
  });

  it("파서가 모르는 문법을 쓰지 않는다", () => {
    // 링크·이미지·코드블록·중첩 목록은 지원하지 않는다. 쓰면 화면에서 원문이 그대로 보인다.
    for (const [index, line] of PRIVACY.split("\n").entries()) {
      const at = `${index + 1}행: ${line}`;
      expect(line, at).not.toMatch(/!\[|\]\(/);
      expect(line, at).not.toMatch(/^```/);
      expect(line, at).not.toMatch(/^\s+[-*]\s/);
    }
  });

  it("줄이 이어붙을 때 낱말이 갈라지지 않는다", () => {
    // 소프트 줄바꿈은 공백이 된다 — 중점이나 여는 괄호에서 끊으면 화면에 틈이 생긴다.
    for (const [index, line] of PRIVACY.split("\n").entries()) {
      expect(line, `${index + 1}행: ${line}`).not.toMatch(/[·(]$/);
    }
  });

  it("표시 문자가 본문에 남지 않는다", () => {
    for (const block of blocks) {
      expect(blockText(block)).not.toMatch(/\*\*|^#|`/);
    }
  });
});

describe("시작 가이드 문서를 화면에 낼 수 있다", () => {
  const blocks = parseMarkdown(START);

  it("제목으로 시작하고 단계마다 `##` 를 쓴다", () => {
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
    expect(blocks.filter((b) => b.kind === "heading" && b.level === 2).length).toBeGreaterThan(5);
  });

  it("이미지 줄이 모두 이미지 블록이 된다", () => {
    const lines = START.split("\n").filter((line) => line.startsWith("!["));
    expect(blocks.filter((b) => b.kind === "image")).toHaveLength(lines.length);
  });

  it("사진마다 설명이 있다", () => {
    // 설명이 곧 alt 이자 캡션이다. 화면을 보지 않는 사용자에게는 이것이 사진이다.
    for (const block of blocks) {
      if (block.kind === "image") expect(block.alt.length, block.src).toBeGreaterThan(0);
    }
  });

  it("파서가 모르는 문법을 쓰지 않는다", () => {
    for (const [index, line] of START.split("\n").entries()) {
      const at = `${index + 1}행: ${line}`;
      if (line.startsWith("![")) continue;
      expect(line, at).not.toMatch(/!\[|\]\(/);
      expect(line, at).not.toMatch(/^```/);
      expect(line, at).not.toMatch(/^\s+[-*]\s/);
    }
  });

  it("표시 문자가 본문에 남지 않는다", () => {
    for (const block of blocks) {
      if (block.kind === "image") continue;
      expect(blockText(block)).not.toMatch(/\*\*|^#|`/);
    }
  });
});
