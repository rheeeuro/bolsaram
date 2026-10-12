/**
 * 업데이트 소식 주간 작업의 문서 조작과 거름.
 *
 * 주간 작업은 사람 확인 없이 `docs/guide/updates.md` 에 바로 싣는다. 그래서 순서가
 * 어긋나거나 손으로 고친 문장이 지워지거나 내부 용어가 새는 일을 여기서 막는다.
 */
import { describe, expect, it } from "vitest";
import { updateItemsSchema, UPDATE_ITEMS_MAX } from "@bolsaram/schemas";
import {
  addWeekItems,
  headingStart,
  keepItem,
  weekHeading,
  weekItems,
  weekOf,
} from "../scripts/updates-doc";

const DOC = `# 업데이트 소식

머리말입니다.

## 2026년 10월 12일 ~ 18일

- 이번 주 항목

## 2026년 9월 28일 ~ 10월 4일

- 오래된 항목
`;

describe("주 계산", () => {
  it("어느 요일이든 그 주 월요일부터 다음 월요일까지다", () => {
    for (const day of [12, 14, 18]) {
      const week = weekOf(new Date(2026, 9, day, 15));
      expect(week.monday).toEqual(new Date(2026, 9, 12));
      expect(week.nextMonday).toEqual(new Date(2026, 9, 19));
    }
  });

  it("제목이 달·해가 바뀌는 주를 표기한다", () => {
    expect(weekHeading(weekOf(new Date(2026, 9, 14)))).toBe("2026년 10월 12일 ~ 18일");
    expect(weekHeading(weekOf(new Date(2026, 8, 30)))).toBe("2026년 9월 28일 ~ 10월 4일");
    expect(weekHeading(weekOf(new Date(2026, 11, 30)))).toBe("2026년 12월 28일 ~ 2027년 1월 3일");
  });

  it("제목에서 시작일을 되읽는다", () => {
    const week = weekOf(new Date(2026, 11, 30));
    expect(headingStart(weekHeading(week))).toEqual(week.monday);
    expect(headingStart("10월 소식")).toBeNull();
  });
});

describe("문서에 싣기", () => {
  it("있는 주에는 새 항목만 덧붙이고 기존 문장을 남긴다", () => {
    const next = addWeekItems(DOC, "2026년 10월 12일 ~ 18일", ["이번 주 항목", "새 항목"]);
    expect(weekItems(next, "2026년 10월 12일 ~ 18일")).toEqual(["이번 주 항목", "새 항목"]);
    expect(weekItems(next, "2026년 9월 28일 ~ 10월 4일")).toEqual(["오래된 항목"]);
    expect(next).toContain("머리말입니다.");
  });

  it("새 주는 날짜 순서에 맞는 자리에 들어간다", () => {
    const newest = addWeekItems(DOC, "2026년 10월 19일 ~ 25일", ["가장 새 항목"]);
    const between = addWeekItems(DOC, "2026년 10월 5일 ~ 11일", ["가운데 항목"]);
    const oldest = addWeekItems(DOC, "2026년 9월 7일 ~ 13일", ["가장 오래된 항목"]);
    const order = (doc: string) => [...doc.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(order(newest)[0]).toBe("2026년 10월 19일 ~ 25일");
    expect(order(between)).toEqual([
      "2026년 10월 12일 ~ 18일",
      "2026년 10월 5일 ~ 11일",
      "2026년 9월 28일 ~ 10월 4일",
    ]);
    expect(order(oldest).at(-1)).toBe("2026년 9월 7일 ~ 13일");
  });

  it("더할 것이 없으면 문서를 그대로 둔다", () => {
    expect(addWeekItems(DOC, "2026년 10월 12일 ~ 18일", ["이번 주 항목"])).toBe(DOC);
    expect(addWeekItems(DOC, "2026년 10월 19일 ~ 25일", [])).toBe(DOC);
  });

  it("주 제목 형식이 아니면 싣지 않는다", () => {
    expect(() => addWeekItems(DOC, "이번 주", ["항목"])).toThrow();
  });
});

describe("거름", () => {
  it("화면 이야기는 통과한다", () => {
    expect(keepItem("프로필 상세에서 **끌어올리기**로 목록 앞에 다시 세울 수 있습니다.")).toBe(true);
    expect(keepItem("프로필 사진은 5장까지 올립니다.")).toBe(true);
  });

  it("내부 작업과 코드 이름은 버린다", () => {
    for (const text of [
      "통합 테스트가 별도 DB 에서 돕니다.",
      "마이그레이션으로 정책을 고쳤습니다.",
      "`/api/health` 로 상태를 봅니다.",
      "profile-raw-list.tsx 를 정리했습니다.",
      "withRls 를 거치게 했습니다.",
      "bumped_at 컬럼을 더했습니다.",
      "9e606f7 에서 고쳤습니다.",
    ]) {
      expect(keepItem(text), text).toBe(false);
    }
  });

  it("AI 응답은 개수와 길이를 넘지 못한다", () => {
    expect(updateItemsSchema.safeParse({ items: ["항목"] }).success).toBe(true);
    expect(updateItemsSchema.safeParse({ items: [""] }).success).toBe(false);
    expect(updateItemsSchema.safeParse({ items: ["가".repeat(301)] }).success).toBe(false);
    expect(
      updateItemsSchema.safeParse({ items: Array.from({ length: UPDATE_ITEMS_MAX + 1 }, () => "항목") })
        .success,
    ).toBe(false);
  });
});
