/**
 * 사용자 가이드(`docs/guide/`)가 실제 구현과 어긋나지 않는지 검사한다.
 *
 * 가이드는 사용자가 읽는 문서라 틀리면 곧바로 문의로 돌아온다. 기능을 바꿨는데
 * 문서를 안 고치는 일을 사람 기억에 맡기지 않고 여기서 잡는다.
 *
 * 검사 대상은 **바뀌면 사용자 경험이 달라지는 사실**뿐이다.
 * 문구나 표현은 검사하지 않는다 — 그렇게 하면 문서를 조금만 다듬어도 깨진다.
 *
 * 이 테스트가 실패하면 둘 중 하나다.
 *   1) 코드를 바꿨는데 가이드를 안 고쳤다 → 가이드를 고친다
 *   2) 정책을 의도적으로 바꿨다 → 가이드와 이 테스트를 함께 고친다
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOW_CONFIDENCE_THRESHOLD,
  MATCH_REQUEST_STATUS_LABELS,
  PROFILE_STATUS_LABELS,
  VISIBILITY_LABELS,
  REQUIRED_FIELDS_FOR_COMMIT,
} from "@bolsaram/schemas";

const ROOT = path.resolve(import.meta.dirname, "..");
const GUIDE_DIR = path.join(ROOT, "docs", "guide");

const GUIDE_FILES = ["README.md", "member.md", "admin.md", "faq.md"];

function guide(name: string): string {
  return readFileSync(path.join(GUIDE_DIR, name), "utf8");
}

/** 모든 가이드를 이어붙인 텍스트. "어딘가에 적혀 있는가"를 볼 때 쓴다. */
const ALL = GUIDE_FILES.map(guide).join("\n");

/** 소스에서 `const NAME = <숫자>` 형태의 상수를 뽑는다. import 하면 server-only 에 걸린다. */
function constantOf(relPath: string, name: string): number {
  const source = readFileSync(path.join(ROOT, relPath), "utf8");
  const match = new RegExp(`${name}\\s*[:=]\\s*([0-9_*\\s]+?)[;,\\n]`).exec(source);
  if (!match?.[1]) throw new Error(`${relPath} 에서 ${name} 을 찾지 못했습니다`);
  // `5 * 60_000` 같은 식도 계산한다.
  const expression = match[1].replace(/_/g, "").trim();
  if (!/^[0-9*\s]+$/.test(expression)) {
    throw new Error(`${name} 값을 해석할 수 없습니다: ${expression}`);
  }
  return expression.split("*").reduce((acc, part) => acc * Number(part.trim()), 1);
}

describe("가이드 파일", () => {
  it("네 문서가 모두 있다", () => {
    for (const name of GUIDE_FILES) {
      expect(existsSync(path.join(GUIDE_DIR, name)), `${name} 없음`).toBe(true);
    }
  });

  it("인덱스가 나머지 문서를 모두 링크한다", () => {
    const index = guide("README.md");
    for (const name of GUIDE_FILES.filter((f) => f !== "README.md")) {
      expect(index, `README 에 ${name} 링크 없음`).toContain(`(${name})`);
    }
  });
});

describe("가이드가 언급하는 화면이 실제로 있다", () => {
  /** 가이드 본문에서 `/discover` 같은 앱 경로를 뽑는다(코드블록·URL 제외). */
  const mentioned = new Set(
    [...ALL.matchAll(/`(\/[a-z][a-z0-9/-]*)`/g)]
      .map((m) => m[1]!)
      .filter((p) => !p.startsWith("/api")),
  );

  const pageRoutes = new Set<string>();
  function collect(dir: string, prefix = ""): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "page.tsx") pageRoutes.add(prefix === "" ? "/" : prefix);
      if (!entry.isDirectory()) continue;
      // (member) 같은 라우트 그룹은 URL 에 나타나지 않는다.
      const segment = /^\(.*\)$/.test(entry.name) ? "" : `/${entry.name}`;
      collect(path.join(dir, entry.name), prefix + segment);
    }
  }
  collect(path.join(ROOT, "apps", "web", "src", "app"));

  it("가이드에 적힌 경로가 하나 이상 있다", () => {
    expect(mentioned.size).toBeGreaterThan(0);
  });

  for (const route of [...mentioned].sort()) {
    it(`${route} 페이지가 존재한다`, () => {
      // 동적 구간(/admin/profiles/[id])은 정적 경로로 매칭되지 않으므로 접두어로 확인한다.
      const exists =
        pageRoutes.has(route) || [...pageRoutes].some((r) => r.startsWith(`${route}/`));
      expect(exists, `${route} 를 가이드가 안내하지만 페이지가 없습니다`).toBe(true);
    });
  }
});

describe("가이드에 적힌 정책 숫자가 코드와 같다", () => {
  it("인증번호 유효시간 5분", () => {
    const ms = constantOf("apps/web/src/server/auth/login.ts", "OTP_TTL_MS");
    expect(ms / 60_000).toBe(5);
    expect(ALL).toMatch(/5분/);
  });

  it("인증번호 재요청 대기 30초", () => {
    const ms = constantOf("apps/web/src/server/auth/login.ts", "OTP_RESEND_COOLDOWN_MS");
    expect(ms / 1000).toBe(30);
    expect(ALL).toMatch(/30초/);
  });

  it("인증번호 시도 횟수 5회", () => {
    expect(constantOf("apps/web/src/server/auth/login.ts", "OTP_MAX_ATTEMPTS")).toBe(5);
    expect(ALL).toMatch(/5(번|회)/);
  });

  it("로그인 유지 30일", () => {
    expect(constantOf("apps/web/src/server/auth/session.ts", "SESSION_TTL_DAYS")).toBe(30);
    expect(ALL).toMatch(/30일/);
  });

  it("초대 기본 유효기간 72시간", () => {
    const source = readFileSync(path.join(ROOT, "packages/schemas/src/auth.ts"), "utf8");
    expect(source).toMatch(/expiresInHours[\s\S]{0,120}?\.default\(72\)/);
    expect(ALL).toMatch(/72시간/);
  });

  it("사진 업로드 상한 25MB", () => {
    const source = readFileSync(
      path.join(ROOT, "apps/web/src/server/storage/local.ts"),
      "utf8",
    );
    const match = /MAX_IMAGE_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(source);
    expect(match?.[1]).toBe("25");
    expect(ALL).toMatch(/25MB/);
  });

  it("AI 분석에 쓰는 사진 장수 6장", () => {
    const n = constantOf(
      "apps/web/src/server/services/import-service.ts",
      "MAX_ANALYZE_IMAGES",
    );
    expect(n).toBe(6);
    expect(ALL).toMatch(/6장/);
  });

  it("낮은 신뢰도 기준 65%", () => {
    expect(Math.round(LOW_CONFIDENCE_THRESHOLD * 100)).toBe(65);
    expect(ALL).toMatch(/65%/);
  });

  it("정리 작업 시각 04:10", () => {
    const eco = readFileSync(path.join(ROOT, "ecosystem.config.cjs"), "utf8");
    const match = /cron_restart:\s*"(\d+)\s+(\d+)\s/.exec(eco);
    expect(match?.[2]).toBe("4");
    expect(match?.[1]).toBe("10");
    expect(ALL).toMatch(/4시 10분/);
  });

  it("Discover 기본 필터 범위", () => {
    const source = readFileSync(
      path.join(ROOT, "apps/web/src/components/member/filter-sheet.tsx"),
      "utf8",
    );
    const block = /DEFAULT_FILTERS[\s\S]*?\};/.exec(source)?.[0] ?? "";
    const num = (key: string) => Number(new RegExp(`${key}:\\s*(\\d+)`).exec(block)?.[1]);
    expect(num("ageMin")).toBe(25);
    expect(num("ageMax")).toBe(38);
    expect(num("heightMin")).toBe(150);
    expect(num("heightMax")).toBe(195);

    const member = guide("member.md");
    expect(member).toMatch(/25\s*–\s*38세/);
    expect(member).toMatch(/150\s*–\s*195cm/);
  });
});

describe("가이드가 설명하는 상태가 코드의 상태와 같다", () => {
  it("프로필 상태 라벨이 모두 관리자 가이드에 있다", () => {
    const admin = guide("admin.md");
    for (const label of Object.values(PROFILE_STATUS_LABELS)) {
      expect(admin, `프로필 상태 "${label}" 설명 없음`).toContain(label);
    }
  });

  it("노출 설정 라벨이 모두 관리자 가이드에 있다", () => {
    const admin = guide("admin.md");
    for (const label of Object.values(VISIBILITY_LABELS)) {
      expect(admin, `노출 설정 "${label}" 설명 없음`).toContain(label);
    }
  });

  it("신청 상태 라벨이 모두 가이드에 있다", () => {
    for (const label of Object.values(MATCH_REQUEST_STATUS_LABELS)) {
      expect(ALL, `신청 상태 "${label}" 설명 없음`).toContain(label);
    }
  });

  it("게시에 반드시 필요한 항목을 관리자 가이드가 알려준다", () => {
    const admin = guide("admin.md");
    const KOREAN: Record<string, string> = {
      gender: "성별",
      birthYear: "출생연도",
      residenceRegion: "거주 지역",
    };
    for (const field of REQUIRED_FIELDS_FOR_COMMIT) {
      const label = KOREAN[field];
      expect(label, `${field} 의 한글 이름이 테스트에 없음`).toBeDefined();
      expect(admin, `필수 항목 "${label}" 안내 없음`).toContain(label!);
    }
  });
});

describe("가이드가 보안 약속을 정확히 설명한다", () => {
  it("연결 전에는 이름·연락처가 공개되지 않는다고 적혀 있다", () => {
    // 이 약속은 domain 의 projectProfile 이 강제한다(tests/visibility.test.ts).
    expect(ALL).toMatch(/연결.*(뒤|후|이후).*(이름|연락)/);
  });

  it("로그인 없이는 아무 프로필도 볼 수 없다고 적혀 있다", () => {
    // RLS 정책이 강제한다(tests/rls.test.ts 「익명은 아무 프로필도 보지 못한다」).
    expect(ALL).toMatch(/로그인하지 않(은|으면)/);
  });

  it("AI 결과가 검토 없이 게시되지 않는다고 적혀 있다", () => {
    // assertCommittable 이 강제한다(tests/import-normalization.test.ts).
    expect(guide("admin.md")).toMatch(/확인이 필요한 항목이 남아 있으면/);
  });
});
