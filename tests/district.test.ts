/** 서울·경기 세부 지역 — 권역 표, 광역과의 짝, 권역 필터와 칩 선택 규칙. */
import { describe, expect, it } from "vitest";
import { buildAttributeClauses } from "@bolsaram/domain";
import {
  AREAS,
  AREA_DISTRICTS,
  DISTRICTS,
  DISTRICT_REGIONS,
  areaRegion,
  districtArea,
  districtRegion,
  districtsOf,
  extractedFieldsSchema,
  matchDistrict,
  profileUpdateSchema,
  reconcileResidence,
  discoverQuerySchema,
} from "@bolsaram/schemas";
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  clearFilter,
  filterSummary,
  filtersFromParams,
  filtersToParams,
  regionSelection,
  toggleArea,
  toggleRegion,
  type Filters,
} from "../apps/web/src/components/member/filter-model";

describe("권역 표", () => {
  it("서울 25개 구와 경기 31개 시·군이 있다", () => {
    expect(districtsOf("SEOUL")).toHaveLength(25);
    expect(districtsOf("GYEONGGI")).toHaveLength(31);
    expect(districtsOf("BUSAN")).toEqual([]);
  });

  it("모든 구·시·군이 정확히 한 권역에 들고, 권역은 같은 광역 것만 묶는다", () => {
    const seen = AREAS.flatMap((area) => AREA_DISTRICTS[area]);
    expect([...seen].sort()).toEqual([...DISTRICTS].sort());
    for (const area of AREAS) {
      for (const district of AREA_DISTRICTS[area]) {
        expect(districtRegion(district)).toBe(areaRegion(area));
        expect(districtArea(district)).toBe(area);
      }
    }
  });

  it("세부 지역 광역은 서울·경기뿐이다", () => {
    expect(new Set(DISTRICTS.map(districtRegion))).toEqual(new Set(DISTRICT_REGIONS));
  });
});

describe("reconcileResidence", () => {
  it("구·시·군만 있으면 광역을 거기서 정한다", () => {
    expect(reconcileResidence(null, "GYEONGGI_SEONGNAM")).toEqual({
      region: "GYEONGGI",
      district: "GYEONGGI_SEONGNAM",
    });
  });

  it("광역과 어긋나면 광역을 믿고 구·시·군을 버린다", () => {
    expect(reconcileResidence("BUSAN", "SEOUL_GANGNAM")).toEqual({
      region: "BUSAN",
      district: null,
    });
    expect(reconcileResidence("SEOUL", "SEOUL_GANGNAM").district).toBe("SEOUL_GANGNAM");
    expect(reconcileResidence("SEOUL", undefined)).toEqual({ region: "SEOUL", district: null });
  });
});

describe("matchDistrict", () => {
  it("동네 이름을 구·시로 옮긴다", () => {
    expect(matchDistrict("분당 정자동")).toBe("GYEONGGI_SEONGNAM");
    expect(matchDistrict("서울 잠실")).toBe("SEOUL_SONGPA");
    expect(matchDistrict("일산 거주")).toBe("GYEONGGI_GOYANG");
  });

  it("다른 낱말과 겹치는 이름에 걸리지 않는다", () => {
    expect(matchDistrict("고양이 두 마리와 산다")).toBeNull();
    expect(matchDistrict("양주 한 잔")).toBeNull();
    expect(matchDistrict("광주광역시")).toBeNull();
  });

  it("여러 곳이 나오면 먼저 나온 곳이다 — 「남양주」를 「양주」로 읽지 않는다", () => {
    expect(matchDistrict("남양주시 다산동")).toBe("GYEONGGI_NAMYANGJU");
    expect(matchDistrict("송파 거주, 판교 근무")).toBe("SEOUL_SONGPA");
  });
});

describe("스키마", () => {
  it("추출 결과와 프로필 수정이 구·시·군을 받는다", () => {
    expect(extractedFieldsSchema.shape.residenceDistrict.parse("SEOUL_MAPO")).toBe("SEOUL_MAPO");
    expect(() => extractedFieldsSchema.shape.residenceDistrict.parse("MAPO")).toThrow();
    // 기본값을 두지 않는다 — 다른 칸만 고치는 수정이 구·시·군을 지우면 안 된다.
    expect(profileUpdateSchema.parse({ hostComment: "x" })).not.toHaveProperty(
      "residenceDistrict",
    );
  });

  it("주소의 권역은 아는 값만 받는다", () => {
    expect(discoverQuerySchema.parse({ areas: "SEOUL_GANGNAM_SEOCHO" }).areas).toEqual([
      "SEOUL_GANGNAM_SEOCHO",
    ]);
    expect(() => discoverQuerySchema.parse({ areas: "SEOUL_GANGNAM" })).toThrow();
  });
});

describe("권역 필터 → SQL", () => {
  const collect = (raw: Record<string, unknown>) => {
    const values: unknown[] = [];
    const push = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    const clauses = buildAttributeClauses(discoverQuerySchema.parse(raw), 2026, push);
    return { clauses, values };
  };

  it("권역만 고르면 그 권역의 구·시·군으로 거른다", () => {
    const { clauses, values } = collect({ areas: "SEOUL_GANGNAM_SEOCHO,GYEONGGI_ILSAN_GIMPO" });
    expect(clauses).toEqual(["p.residence_district = ANY($1)"]);
    expect(values).toEqual([
      ["SEOUL_GANGNAM", "SEOUL_SEOCHO", "GYEONGGI_GOYANG", "GYEONGGI_PAJU", "GYEONGGI_GIMPO"],
    ]);
  });

  it("광역 전체와 권역을 함께 고르면 둘 중 하나에 들면 남는다", () => {
    const { clauses, values } = collect({ regions: "BUSAN", areas: "SEOUL_JAMSIL_GANGDONG" });
    expect(clauses).toEqual([
      "(p.residence_region = ANY($1) OR p.residence_district = ANY($2))",
    ]);
    expect(values).toEqual([["BUSAN"], ["SEOUL_SONGPA", "SEOUL_GANGDONG"]]);
  });
});

describe("지역 칩 선택", () => {
  const base: Filters = { ...DEFAULT_FILTERS };

  it("광역 칩을 누르면 그 광역 전체다 — 골라 둔 권역은 전체로 바뀐다", () => {
    const some = toggleArea(base, "SEOUL_GANGNAM_SEOCHO");
    expect(regionSelection(some, "SEOUL")).toBe("some");
    const whole = toggleRegion(some, "SEOUL");
    expect(whole.regions).toEqual(["SEOUL"]);
    expect(whole.areas).toEqual([]);
    expect(regionSelection(whole, "SEOUL")).toBe("all");
    expect(toggleRegion(whole, "SEOUL").regions).toEqual([]);
  });

  it("전체가 골라진 광역에서 권역을 누르면 그 권역 하나로 좁힌다", () => {
    const narrowed = toggleArea(toggleRegion(base, "SEOUL"), "SEOUL_HONGDAE_SINCHON");
    expect(narrowed.regions).toEqual([]);
    expect(narrowed.areas).toEqual(["SEOUL_HONGDAE_SINCHON"]);
  });

  it("권역을 전부 고르면 광역 전체로 접는다", () => {
    let filters = base;
    for (const area of AREAS.filter((a) => areaRegion(a) === "GYEONGGI")) {
      filters = toggleArea(filters, area);
    }
    expect(filters.regions).toEqual(["GYEONGGI"]);
    expect(filters.areas).toEqual([]);
  });

  it("다른 광역의 권역은 건드리지 않는다", () => {
    const filters = toggleRegion(toggleArea(base, "GYEONGGI_BUNDANG_YONGIN"), "SEOUL");
    expect(filters.areas).toEqual(["GYEONGGI_BUNDANG_YONGIN"]);
    expect(filters.regions).toEqual(["SEOUL"]);
  });

  it("광역과 권역은 조건 하나로 세고, 칩 하나로 지운다", () => {
    const filters: Filters = {
      ...base,
      regions: ["BUSAN"],
      areas: ["SEOUL_GANGNAM_SEOCHO", "SEOUL_JAMSIL_GANGDONG"],
    };
    expect(activeFilterCount(filters)).toBe(1);
    expect(filterSummary(filters, 2026).map((i) => i.label)).toEqual([
      "부산 · 서울 강남·서초, 잠실·강동",
    ]);
    const cleared = clearFilter(filters, "regions");
    expect(cleared.regions).toEqual([]);
    expect(cleared.areas).toEqual([]);
  });

  it("주소로 오가도 권역이 그대로이고, 모르는 권역은 버린다", () => {
    const filters: Filters = { ...base, areas: ["SEOUL_SADANG_SILLIM"] };
    expect(filtersFromParams(filtersToParams(filters))).toEqual(filters);
    expect(filtersFromParams(new URLSearchParams("areas=NOPE,SEOUL_SADANG_SILLIM")).areas).toEqual(
      ["SEOUL_SADANG_SILLIM"],
    );
  });
});
