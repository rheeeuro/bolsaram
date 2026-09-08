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
  AGE_RANGE,
  HEIGHT_RANGE,
} from "../apps/web/src/components/member/filter-model";
import {
  LOW_CONFIDENCE_THRESHOLD,
  MATCH_REQUEST_STATUS_LABELS,
  PROFILE_STATUS_LABELS,
  VISIBILITY_LABELS,
  REQUIRED_FIELDS_FOR_COMMIT,
} from "@bolsaram/schemas";
import { TELEGRAM_COMMANDS, TELEGRAM_SESSION_TTL_HOURS } from "@bolsaram/domain";
import { TELEGRAM_MAX_FILE_BYTES } from "@bolsaram/schemas";

const ROOT = path.resolve(import.meta.dirname, "..");
const GUIDE_DIR = path.join(ROOT, "docs", "guide");

const GUIDE_FILES = ["README.md", "member.md", "admin.md", "faq.md", "privacy.md"];

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
  /**
   * 가이드 본문에서 `/discover` 같은 앱 경로를 뽑는다(코드블록·URL 제외).
   *
   * 텔레그램 봇 명령(`/new` 등)은 앱 경로가 아니라 다른 이름 공간이므로 제외한다.
   * 목록을 코드에서 가져오므로 명령을 추가하면 여기도 자동으로 따라온다.
   */
  const botCommands = new Set<string>(TELEGRAM_COMMANDS);
  const mentioned = new Set(
    [...ALL.matchAll(/`(\/[a-z][a-z0-9/-]*)`/g)]
      .map((m) => m[1]!)
      .filter((p) => !p.startsWith("/api") && !botCommands.has(p)),
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
  it("회원 로그인에 인증번호를 쓰지 않는다", () => {
    // SMS 를 쓰지 않기로 해서 OTP 경로를 제거했다(0015). 안 쓰는 인증 경로를
    // 코드에 남겨두면 가이드와 실제가 어긋난다.
    // 주석에는 "OTP 경로를 제거했다"처럼 남을 수 있으므로 **함수와 상수**만 본다.
    const login = readFileSync(
      path.join(ROOT, "apps/web/src/server/auth/login.ts"),
      "utf8",
    );
    expect(login).not.toMatch(/issueLoginCode|verifyLoginCode|OTP_TTL_MS|OTP_MAX_ATTEMPTS/);
    // 회원 로그인 경로는 초대 링크뿐이다.
    expect(guide("member.md")).toMatch(/링크/);
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

  it("낮은 신뢰도 기준 65%", () => {
    expect(Math.round(LOW_CONFIDENCE_THRESHOLD * 100)).toBe(65);
    expect(ALL).toMatch(/65%/);
  });

  /** cron 앱이 여러 개라 이름으로 찾는다 — 첫 cron_restart 를 집으면 순서에 흔들린다. */
  const cronOf = (appName: string): { hour: string; minute: string } => {
    const eco = readFileSync(path.join(ROOT, "ecosystem.config.cjs"), "utf8");
    const block = new RegExp(`name:\\s*"${appName}"[\\s\\S]*?cron_restart:\\s*"(\\d+)\\s+(\\d+)\\s`);
    const match = block.exec(eco);
    return { minute: match?.[1] ?? "", hour: match?.[2] ?? "" };
  };

  it("정리 작업 시각 04:10", () => {
    expect(cronOf("bolsaram-cleanup")).toEqual({ hour: "4", minute: "10" });
    expect(ALL).toMatch(/4시 10분/);
  });

  it("백업 시각 03:40 — 정리보다 먼저 돈다", () => {
    // 정리가 지운 것도 하루치 백업에는 남아 있어야 실수를 되돌릴 수 있다.
    expect(cronOf("bolsaram-backup")).toEqual({ hour: "3", minute: "40" });
    expect(ALL).toMatch(/3시 40분/);
  });

  it("관리자 로그인 시도 제한 5회 / 15분", () => {
    const src = "apps/web/src/server/auth/login.ts";
    expect(constantOf(src, "ADMIN_LOGIN_MAX_FAILURES")).toBe(5);
    expect(constantOf(src, "ADMIN_LOGIN_WINDOW_MS") / 60_000).toBe(15);
    const admin = guide("admin.md");
    expect(admin).toMatch(/15분 안에 5번/);
  });

  it("봇 연결 코드 유효시간 15분", () => {
    const minutes = constantOf(
      "apps/web/src/server/auth/telegram.ts",
      "TELEGRAM_LINK_CODE_TTL_MINUTES",
    );
    expect(minutes).toBe(15);
    expect(guide("admin.md")).toMatch(/15분/);
  });

  it("봇으로 받는 사진 상한 20MB", () => {
    // Bot API 의 getFile 제약이라 웹 업로드 상한(25MB)과 다르다. 둘 다 안내해야 한다.
    expect(TELEGRAM_MAX_FILE_BYTES / (1024 * 1024)).toBe(20);
    expect(ALL).toMatch(/20MB/);
  });

  it("봇 대화 만료 24시간", () => {
    expect(TELEGRAM_SESSION_TTL_HOURS).toBe(24);
    expect(guide("admin.md")).toMatch(/24시간/);
  });

  it("가이드가 고를 수 있는 필터 범위를 코드와 같게 적는다", () => {
    // 기본값이 양끝이라 "손대지 않으면 전체" 다. 그 규약은 filters.test.ts 가 지킨다.
    const member = guide("member.md");
    expect(member).toMatch(new RegExp(`${AGE_RANGE.min}\\s*–\\s*${AGE_RANGE.max}세`));
    expect(member).toMatch(new RegExp(`${HEIGHT_RANGE.min}\\s*–\\s*${HEIGHT_RANGE.max}cm`));
    expect(member).toMatch(/양끝에 두면 그 조건은 걸리지\s*\n?않습니다/);
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

  it("봇 명령이 모두 관리자 가이드에 있다", () => {
    // 명령을 추가했는데 안내하지 않으면 운영자가 알 방법이 없다.
    const admin = guide("admin.md");
    for (const command of TELEGRAM_COMMANDS) {
      expect(admin, `봇 명령 "${command}" 안내 없음`).toContain(command);
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

describe("개인정보 처리방침이 실제 동작과 같다", () => {
  const privacy = () => guide("privacy.md");

  it("보관 기간이 정리 작업의 값과 같다", () => {
    // 방침에 적은 숫자가 실제 정리 주기와 다르면 지키지 않는 약속이 된다.
    const source = readFileSync(path.join(ROOT, "packages/db/src/cleanup.ts"), "utf8");
    const days = (key: string) =>
      Number(new RegExp(`${key}:\\s*(\\d+)`).exec(source)?.[1]);
    const text = privacy();
    for (const [key, label] of [
      ["sessions", "30일"],
      ["invites", "90일"],
      ["abandonedImports", "30일"],
      ["rawModelOutput", "14일"],
      ["auditLogs", "365일"],
    ] as const) {
      expect(days(key), `${key} 상수를 읽지 못했습니다`).toBeGreaterThan(0);
      expect(text, `${key} 보관 기간이 방침에 없습니다`).toContain(`${days(key)}일`);
    }
  });

  it("사진을 AI 에 보내지 않는다고 적혀 있다", () => {
    // ExtractionInput 에 이미지 필드가 없어서 구조적으로 불가능하다.
    expect(privacy()).toMatch(/사진은 AI ?에 보내지 않습니다/);
  });

  it("연결 전에는 이름·연락처가 보이지 않는다고 적혀 있다", () => {
    expect(privacy()).toMatch(/이름과 연락 방법은.*연결되기 전까지/s);
  });

  it("전체공개 범위를 분명히 밝힌다", () => {
    // 주선자 가입이 열려 있으므로 이 사실을 숨기면 안 된다.
    expect(privacy()).toMatch(/전체공개로 등록된 프로필은 가입한 모든 주선자가 봅니다/);
  });

  it("아직 정하지 않은 것을 숨기지 않는다", () => {
    // 동의 절차와 책임자가 비어 있다 — 공개 전에 채워야 한다.
    expect(privacy()).toMatch(/동의/);
    expect(privacy()).toMatch(/개인정보 보호책임자|책임자/);
  });
});

describe("가이드가 인용한 오류 문구가 코드에 실제로 있다", () => {
  /**
   * 가이드 본문의 표현은 검사하지 않지만, **가이드가 따옴표로 인용한 오류 문구**는
   * 다르다. 사용자는 화면에 뜬 문장을 그대로 들고 문서를 찾는다. 코드에 없는 문장이
   * 표에 남아 있으면 그 줄은 아무도 찾지 못하는 죽은 항목이다.
   *
   * 실제로 두 건이 그렇게 남아 있었다(2026-09-08) — SMS 를 걷어내면서 사라진
   * 「초대된 번호가 아닙니다」와, 코드와 다르게 적힌 연결 충돌 문구.
   *
   * 문구가 **어딘가에 존재하는지**만 본다. 설명이 맞는지는 사람이 본다.
   */
  const SOURCE = (() => {
    const chunks: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) chunks.push(readFileSync(full, "utf8"));
      }
    };
    walk(path.join(ROOT, "apps", "web", "src"));
    walk(path.join(ROOT, "packages"));
    return chunks.join("\n");
  })();

  /** faq.md 「문제 해결」 표의 첫 열과, member.md 가 따옴표로 인용한 문구. */
  const quoted: { message: string; where: string }[] = [];
  {
    const faq = guide("faq.md");
    for (const line of faq.slice(faq.indexOf("## 문제 해결")).split("\n")) {
      const cell = /^\|([^|]+)\|/.exec(line)?.[1]?.trim();
      if (!cell || cell === "메시지" || /^-+$/.test(cell.replace(/\s/g, ""))) continue;
      quoted.push({ message: cell, where: "faq.md" });
    }
    for (const m of guide("member.md").matchAll(/"([^"]+)"/g)) {
      quoted.push({ message: m[1]!, where: "member.md" });
    }
  }

  /**
   * 표에 적힌 형태에서 코드와 대조할 조각을 뽑는다.
   * `(사진)` 같은 보충 설명은 문구가 아니고, `…` 은 표 폭에 맞춘 생략이라 조각으로 나눈다.
   */
  function fragments(message: string): string[] {
    return message
      .replace(/\([^)]*\)/g, " ")
      .replace(/["'.]/g, " ")
      .split("…")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  it("검사할 문구를 찾았다", () => {
    expect(quoted.length).toBeGreaterThan(5);
  });

  for (const { message, where } of quoted) {
    it(`${where}: ${message}`, () => {
      for (const fragment of fragments(message)) {
        expect(
          SOURCE.includes(fragment),
          `가이드가 "${message}" 를 안내하지만 코드에 그런 문구가 없습니다`,
        ).toBe(true);
      }
    });
  }
});

describe("가이드가 보안 약속을 정확히 설명한다", () => {
  it("사진을 AI 에 보내지 않는다고 적혀 있다", () => {
    // ExtractionInput 에 이미지 필드가 없어서 구조적으로 불가능하다.
    const types = readFileSync(
      path.join(ROOT, "apps/web/src/server/ai/types.ts"),
      "utf8",
    );
    expect(types).not.toMatch(/images\??:/);
    expect(guide("admin.md")).toMatch(/사진은.*(보내지 않|전송하지 않)/);
  });

  it("연결 전에는 이름·연락처가 공개되지 않는다고 적혀 있다", () => {
    // 이 약속은 domain 의 projectProfile 이 강제한다(tests/visibility.test.ts).
    expect(ALL).toMatch(/연결.*(뒤|후|이후).*(이름|연락)/);
  });

  it("로그인 없이는 아무 프로필도 볼 수 없다고 적혀 있다", () => {
    // RLS 정책이 강제한다(tests/rls.test.ts 「익명은 아무 프로필도 보지 못한다」).
    expect(ALL).toMatch(/로그인하지 않(은|으면)/);
  });

  it("봇으로 올린 것도 검토를 거친다고 적혀 있다", () => {
    // 게시 게이트는 채널과 무관하게 assertCommittable 이 강제한다.
    expect(guide("admin.md")).toMatch(/봇이 프로필을 공개하는 일은 없습니다/);
  });

  it("텔레그램이 주선자 전용 통로라고 적혀 있다", () => {
    // consumeTelegramLinkCode 가 ADMIN 이 아닌 계정을 거부한다
    // (tests/telegram-import.test.ts 「회원 계정으로는 봇을 연결할 수 없다」).
    expect(ALL).toMatch(/주선자 전용 통로/);
  });

  it("AI 결과가 검토 없이 게시되지 않는다고 적혀 있다", () => {
    // assertCommittable 이 강제한다(tests/import-normalization.test.ts).
    expect(guide("admin.md")).toMatch(/확인이 필요한 항목이 남아 있으면/);
  });
});
