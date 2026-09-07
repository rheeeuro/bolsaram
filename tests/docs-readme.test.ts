/**
 * 디렉터리 README 가 실제 코드 구조와 어긋나지 않는지 검사한다.
 *
 * 각 README 는 그 디렉터리의 "현재 구조" 소스 오브 트루스다. 파일을 추가·삭제·이동했는데
 * 문서를 안 고치면 다음 사람이 없는 파일을 찾아 헤맨다. 그걸 여기서 잡는다.
 *
 * 검사하는 것은 두 방향이다.
 *   1) 죽은 참조 — README 의 코드 트리에 적혔지만 실제로 없는 파일
 *   2) 누락 — 실제로 있지만 README 가 언급하지 않는 소스 파일
 *
 * 설명 문장이나 표 내용은 검사하지 않는다. 그렇게 하면 문서를 다듬을 때마다 깨진다.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * README 를 두는 디렉터리와, 그 안에서 "언급돼야 하는" 소스 파일의 범위.
 *
 * `sourceDir` 는 파일 단위로 검사할 하위 경로다. 라우트처럼 파일이 많고 규칙적인 곳은
 * 디렉터리 단위로만 보므로 여기 넣지 않는다 — 파일마다 문서를 고치게 만들면 문서가 방치된다.
 */
const TARGETS = [
  { dir: "packages/schemas", sourceDir: "src", ext: [".ts"] },
  { dir: "packages/domain", sourceDir: "src", ext: [".ts"] },
  { dir: "packages/db", sourceDir: "src", ext: [".ts"] },
  { dir: "packages/ui-tokens", sourceDir: "src", ext: [".ts", ".css"] },
  { dir: "apps/web", sourceDir: "src/server", ext: [".ts"] },
  { dir: "db", sourceDir: "migrations", ext: [".sql"] },
  { dir: "tests", sourceDir: ".", ext: [".test.ts"] },
] as const;

function readme(dir: string): string {
  return readFileSync(path.join(ROOT, dir, "README.md"), "utf8");
}

/** 하위 파일을 재귀로 모아 `sourceDir` 기준 상대경로로 돌려준다. */
function sourceFiles(dir: string, sourceDir: string, ext: readonly string[]): string[] {
  const base = path.join(ROOT, dir, sourceDir);
  const out: string[] = [];
  function walk(current: string, prefix: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else if (ext.some((e) => entry.name.endsWith(e))) out.push(rel);
    }
  }
  walk(base, "");
  return out.sort();
}

/**
 * README 의 코드블록에서 파일처럼 보이는 토큰을 뽑는다.
 * 트리 그림(`├── client.ts`)과 경로(`src/cli/seed.ts`)를 모두 잡는다.
 */
function mentionedFiles(text: string): Set<string> {
  const blocks = [...text.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]);
  const tokens = new Set<string>();
  for (const block of blocks) {
    // 확장자는 긴 것부터 — `tsx` 를 `ts` 보다 앞에 두지 않으면 `page.tsx` 가 `page.ts` 로 잘린다.
    for (const m of block.matchAll(
      /([A-Za-z0-9_@[\]().-]+(?:\/[A-Za-z0-9_@[\]().-]+)*\.(?:tsx|ts|cjs|css|sql|json|js|md))/g,
    )) {
      tokens.add(m[1]!);
    }
  }
  return tokens;
}

describe("주요 디렉터리에 README 가 있다", () => {
  for (const { dir } of TARGETS) {
    it(`${dir}/README.md`, () => {
      expect(existsSync(path.join(ROOT, dir, "README.md")), `${dir}/README.md 없음`).toBe(true);
    });
  }
});

describe("README 가 없는 파일을 설명하지 않는다", () => {
  for (const { dir, sourceDir } of TARGETS) {
    it(dir, () => {
      const text = readme(dir);
      const base = path.join(ROOT, dir);
      const dead: string[] = [];
      // 죽은 참조는 sourceDir 이 아니라 **디렉터리 전체**를 기준으로 본다.
      // README 는 라우트·설정 등 sourceDir 밖의 파일도 설명하기 때문이다.
      const allFiles = sourceFiles(dir, ".", [
        ".ts",
        ".tsx",
        ".css",
        ".sql",
        ".json",
        ".cjs",
        ".js",
        ".md",
      ]);

      for (const token of mentionedFiles(text)) {
        // 동적 라우트(`[id]`)나 와일드카드가 든 토큰은 실제 경로가 아니므로 건너뛴다.
        if (token.includes("[") || token.includes("*")) continue;
        // 다른 디렉터리를 가리키는 상대 경로(../)는 이 검사 대상이 아니다.
        if (token.startsWith("..")) continue;

        // 트리 그림은 파일명만, 본문은 전체 경로로 적힌다. 어느 기준으로든 찾히면 통과.
        //   - 디렉터리 기준 (packages/db/README 의 `src/client.ts`)
        //   - sourceDir 기준 (트리 그림의 `client.ts`)
        //   - 리포 루트 기준 (`tests/rls.test.ts` 처럼 다른 디렉터리를 가리키는 경우)
        const candidates = [
          path.join(base, token),
          path.join(base, sourceDir, token),
          path.join(base, "src", token),
          path.join(ROOT, token),
        ];
        const found =
          candidates.some((p) => existsSync(p)) ||
          allFiles.some((f) => f === token || f.endsWith(`/${token}`));
        if (!found) dead.push(token);
      }

      expect(dead, `${dir}/README.md 가 없는 파일을 설명합니다: ${dead.join(", ")}`).toEqual(
        [],
      );
    });
  }
});

describe("README 가 실제 소스 파일을 빠뜨리지 않는다", () => {
  for (const { dir, sourceDir, ext } of TARGETS) {
    it(dir, () => {
      const text = readme(dir);
      const missing = sourceFiles(dir, sourceDir, ext).filter((rel) => {
        const name = rel.split("/").pop()!;
        // 전체 경로로 적었거나 파일명만 적었거나 둘 다 인정한다.
        return !text.includes(rel) && !text.includes(name);
      });
      expect(
        missing,
        `${dir}/README.md 에 없는 파일이 있습니다: ${missing.join(", ")}`,
      ).toEqual([]);
    });
  }
});

describe("README 가 자신의 역할을 밝힌다", () => {
  for (const { dir } of TARGETS) {
    it(dir, () => {
      const text = readme(dir);
      // 「이 README 는 …소스 오브 트루스」 문장이 갱신 책임을 명시한다.
      expect(text, `${dir}/README.md 에 소스 오브 트루스 선언이 없습니다`).toMatch(
        /소스 오브 트루스/,
      );
      // 작업 규칙 문서로 연결되어야 한다.
      expect(text, `${dir}/README.md 가 .ai-harness/project.md 를 링크하지 않습니다`).toMatch(
        /ai-harness\/project\.md/,
      );
    });
  }
});

describe("루트 README 가 주요 디렉터리를 안내한다", () => {
  const root = readFileSync(path.join(ROOT, "README.md"), "utf8");
  for (const { dir } of TARGETS) {
    it(dir, () => {
      expect(root, `루트 README 가 ${dir} 를 언급하지 않습니다`).toContain(dir);
    });
  }
});

describe("README 파일 자체가 비어 있지 않다", () => {
  for (const { dir } of TARGETS) {
    it(dir, () => {
      const full = path.join(ROOT, dir, "README.md");
      expect(statSync(full).size, `${dir}/README.md 가 너무 짧습니다`).toBeGreaterThan(500);
    });
  }
});
