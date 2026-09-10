/** Discover 필터 → SQL (부트스트랩 §12 「profile filter」). */
import { describe, expect, it } from "vitest";
import {
  birthYearRange,
  buildDiscoverWhere,
  HAS_PHOTO_SQL,
  PROFILE_ORDER_BY,
  decodeCursor,
  encodeCursor,
} from "@bolsaram/domain";
import { discoverQuerySchema } from "@bolsaram/schemas";
import {
  AGE_RANGE,
  DEFAULT_FILTERS,
  HEIGHT_RANGE,
  activeFilterCount,
  filtersToParams,
  rangeLabel,
  type Filters,
} from "../apps/web/src/components/member/filter-model";

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
    expect(where.text).not.toContain("app_discover_excluded_profile_ids");
  });

  it("거절·숨김 관계를 목록에서 뺀다", () => {
    const where = buildDiscoverWhere(parse({}), CTX);
    expect(where.text).toContain("p.id NOT IN (SELECT app_discover_excluded_profile_ids())");
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
    for (const hasPhoto of [true, false]) {
      const row = { hasPhoto, createdAt: new Date("2026-09-07T01:02:03.456Z"), id: "abc-123" };
      const decoded = decodeCursor(encodeCursor(row));
      expect(decoded?.id).toBe("abc-123");
      expect(decoded?.hasPhoto).toBe(hasPhoto);
      expect(decoded?.createdAt.toISOString()).toBe(row.createdAt.toISOString());
    }
  });

  it("잘못된 커서는 null 로 떨어뜨려 첫 페이지를 준다", () => {
    for (const bad of [
      undefined,
      "",
      "no-separator",
      "1|not-a-date|id",
      "1|2026-01-01T00:00:00Z|",
      // 사진 유무 축이 없는 옛 형식. 정렬이 달라졌으므로 이어붙이지 않고 첫 페이지로 돌린다.
      "2026-01-01T00:00:00Z|abc-123",
      "2|2026-01-01T00:00:00Z|abc-123",
    ]) {
      expect(decodeCursor(bad)).toBeNull();
    }
  });

  it("정렬은 사진 있는 쪽을 먼저, 그 안에서 최신순으로 놓는다", () => {
    // 커서 튜플 비교가 성립하려면 세 키가 모두 DESC 여야 한다.
    expect(PROFILE_ORDER_BY).toBe(`${HAS_PHOTO_SQL} DESC, p.created_at DESC, p.id DESC`);
  });
});

/**
 * 화면의 조건 모델. "보이는 범위"와 "실제로 걸리는 절"이 어긋나면
 * 회원은 걸러졌다고 믿는 사람을 계속 보게 된다 — 그 어긋남을 여기서 막는다.
 */
describe("filtersToParams", () => {
  const withRange = (over: Partial<Filters>): Filters => ({ ...DEFAULT_FILTERS, ...over });
  const of = (filters: Filters) => Object.fromEntries(filtersToParams(filters, null));

  it("손대지 않으면 아무 조건도 보내지 않는다", () => {
    expect(of(DEFAULT_FILTERS)).toEqual({});
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
  });

  it("한쪽만 좁히면 반대쪽 경계도 함께 걸린다", () => {
    // 최소만 옮겼을 때 최대가 빠지면 "30세 – 38세" 라 적어놓고 50세를 보여준다.
    const narrowed = withRange({ ageMin: 30 });
    expect(of(narrowed)).toEqual({ ageMin: "30" });
    expect(rangeLabel({ ...AGE_RANGE, valueMin: 30, valueMax: AGE_RANGE.max, unit: "세" })).toBe(
      "30세 이상",
    );

    const capped = withRange({ ageMax: 38 });
    expect(of(capped)).toEqual({ ageMax: "38" });
    expect(rangeLabel({ ...AGE_RANGE, valueMin: AGE_RANGE.min, valueMax: 38, unit: "세" })).toBe(
      "38세 이하",
    );
  });

  it("양쪽을 좁히면 둘 다 보낸다", () => {
    expect(of(withRange({ ageMin: 30, ageMax: 38 }))).toEqual({ ageMin: "30", ageMax: "38" });
    expect(of(withRange({ heightMin: 160, heightMax: 175 }))).toEqual({
      heightMin: "160",
      heightMax: "175",
    });
  });

  it("보낸 조건 개수와 배지 숫자가 같다", () => {
    const filters = withRange({ ageMin: 30, heightMax: 175, regions: ["SEOUL", "GYEONGGI"] });
    expect(activeFilterCount(filters)).toBe(3);
    expect(of(filters)).toEqual({
      ageMin: "30",
      heightMax: "175",
      regions: "SEOUL,GYEONGGI",
    });
  });

  it("보낸 조건이 SQL 절로 그대로 이어진다", () => {
    const params = filtersToParams(withRange({ ageMin: 30, ageMax: 38 }), null);
    const where = buildDiscoverWhere(parse(Object.fromEntries(params)), CTX);
    expect(where.text).toContain("p.birth_year >= $2");
    expect(where.text).toContain("p.birth_year <= $3");
    expect(where.values).toEqual(["me", 1988, 1996]);
  });

  it("기본값은 슬라이더 양끝과 같다", () => {
    // 기본값이 끝에서 떨어지면 손대지 않은 조건이 사람을 숨긴다.
    expect(DEFAULT_FILTERS.ageMin).toBe(AGE_RANGE.min);
    expect(DEFAULT_FILTERS.ageMax).toBe(AGE_RANGE.max);
    expect(DEFAULT_FILTERS.heightMin).toBe(HEIGHT_RANGE.min);
    expect(DEFAULT_FILTERS.heightMax).toBe(HEIGHT_RANGE.max);
  });

  it("양끝에 붙어 있으면 전체라고 말한다", () => {
    expect(
      rangeLabel({ ...HEIGHT_RANGE, valueMin: 145, valueMax: 200, unit: "cm" }),
    ).toBe("전체");
    expect(
      rangeLabel({ ...HEIGHT_RANGE, valueMin: 160, valueMax: 175, unit: "cm" }),
    ).toBe("160cm – 175cm");
  });
});
