import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseMarkdown, type Block } from "@/lib/markdown";

/**
 * `docs/guide/` 의 사용자 문서를 화면에서 쓴다.
 *
 * 문서가 단일 원본이다 — 같은 내용을 화면용으로 다시 쓰면 둘이 갈라지고, 방침처럼
 * 지켜야 하는 문서에서 그것은 그냥 틀린 문장이 된다.
 *
 * 파일명은 **여기 적힌 것만** 받는다. 슬러그를 경로로 이어붙이는 순간 경로 탈출을
 * 걱정해야 하는데, 문서 수가 적어서 목록으로 두는 편이 확실하다.
 */
const GUIDES = {
  privacy: "privacy.md",
} as const;

export type GuideSlug = keyof typeof GUIDES;

/**
 * 리포 루트. 웹 앱은 `apps/web` 에서 뜨고(`next dev`·`next start`) 다른 도구는
 * 루트에서 도므로 양쪽을 본다.
 */
function guideDir(): string {
  const candidates = [
    path.join(process.cwd(), "docs", "guide"),
    path.join(process.cwd(), "..", "..", "docs", "guide"),
  ];
  return candidates.find((dir) => {
    try {
      readFileSync(path.join(dir, GUIDES.privacy), "utf8");
      return true;
    } catch {
      return false;
    }
  }) ?? candidates[0]!;
}

export function readGuide(slug: GuideSlug): Block[] {
  return parseMarkdown(readFileSync(path.join(guideDir(), GUIDES[slug]), "utf8"));
}
