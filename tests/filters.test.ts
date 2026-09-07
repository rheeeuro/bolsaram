/** Discover 필터 → SQL (부트스트랩 §12 「profile filter」). */
import { describe, expect, it } from "vitest";
import {
  birthYearRange,
  buildDiscoverWhere,
  decodeCursor,
  encodeCursor,
} from "@bolsaram/domain";
import { discoverQuerySchema } from "@bolsaram/schemas";

const CTX = { viewerProfileId: "me", currentYear: 2026 };
const parse = (raw: Record<string, unknown>) => discoverQuerySchema.parse(raw);

describe("birthYearRange", () => {
  it("나이 범위를 출생연도 범위로 뒤집는다", () => {
    expect(birthYearRange({ ageMin: 30, ageMax: 35 }, 2026)).toEqual({ min: 1991, max: 1996 });
  });

  it("한쪽만 주어져도 동작한다", () => {
    expect(birthYearRange({ ageMin: 30 }, 2026)).toEqual({ max: 1996 });
    expect(birthYearRange({ ageMax: 35 }, 2026)).toEqual({ min: 1991 });
  });
});

describe("buildDiscoverWhere", () => {
  it("공개 상태 조건은 항상 붙는다", () => {
    const where = buildDiscoverWhere(parse({}), CTX);
    expect(where.text).toContain("p.status IN ('ACTIVE','MATCHING')");
    expect(where.text).toContain("p.visibility = 'LISTED'");
  });

  it("자기 자신을 제외한다", () => {
    const where = buildDiscoverWhere(parse({}), CTX);
    expect(where.text).toContain("p.id <> $1");
    expect(where.values[0]).toBe("me");
  });

  it("프로필이 없는 열람자는 제외 조건을 걸지 않는다", () => {
    const where = buildDiscoverWhere(parse({}), { ...CTX, viewerProfileId: null });
    expect(where.text).not.toContain("p.id <>");
  });

  it("값은 전부 파라미터로 넘어간다 — SQL 에 리터럴이 끼지 않는다", () => {
    const where = buildDiscoverWhere(
      parse({ q: "'; DROP TABLE profiles; --", gender: "FEMALE" }),
      CTX,
    );
    expect(where.text).not.toContain("DROP TABLE");
    expect(where.values).toContain("%'; DROP TABLE profiles; --%");
  });

  it("자리표시자 번호가 값 개수와 정확히 일치한다", () => {
    const where = buildDiscoverWhere(
      parse({
        gender: "MALE",
        ageMin: 28,
        ageMax: 40,
        heightMin: 170,
        heightMax: 190,
        regions: "SEOUL,GYEONGGI",
        jobCategories: "IT",
        religions: "NONE",
        smoking: "NONE",
        drinking: "SOCIAL",
        q: "러닝",
      }),
      CTX,
    );
    const used = [...where.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...used)).toBe(where.values.length);
    expect(new Set(used).size).toBe(where.values.length);
  });

  it("startIndex 로 자리표시자 번호를 이어붙일 수 있다", () => {
    const where = buildDiscoverWhere(parse({ gender: "FEMALE" }), CTX, 5);
    expect(where.text).toContain("$5");
    expect(where.text).toContain("$6");
  });

  it("쉼표 목록을 배열로 파싱한다", () => {
    const query = parse({ regions: "SEOUL, GYEONGGI ,INCHEON" });
    expect(query.regions).toEqual(["SEOUL", "GYEONGGI", "INCHEON"]);
  });

  it("빈 필터는 값 없이 상태 조건만 만든다", () => {
    const where = buildDiscoverWhere(parse({}), { ...CTX, viewerProfileId: null });
    expect(where.values).toEqual([]);
  });
});

describe("커서", () => {
  it("왕복 인코딩이 값을 보존한다", () => {
    const row = { createdAt: new Date("2026-09-07T01:02:03.456Z"), id: "abc-123" };
    const decoded = decodeCursor(encodeCursor(row));
    expect(decoded?.id).toBe("abc-123");
    expect(decoded?.createdAt.toISOString()).toBe(row.createdAt.toISOString());
  });

  it("잘못된 커서는 null 로 떨어뜨려 첫 페이지를 준다", () => {
    for (const bad of [
      undefined,
      "",
      "no-separator",
      "not-a-date|id",
      "2026-01-01T00:00:00Z|",
    ]) {
      expect(decodeCursor(bad)).toBeNull();
    }
  });
});
