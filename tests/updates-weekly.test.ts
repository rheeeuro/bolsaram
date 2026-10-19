/**
 * 업데이트 소식 주간 작업의 문서 조작과 거름.
 *
 * 주간 작업은 사람 확인 없이 `docs/guide/updates.md` 에 바로 싣는다. 그래서 순서가
 * 어긋나거나 손으로 고친 문장이 지워지거나 내부 용어가 새는 일을 여기서 막는다.
 */
import { describe, expect, it } from "vitest";
import { commitPredicateAnswerSchema, updateItemsSchema, UPDATE_ITEMS_MAX } from "@bolsaram/schemas";
import {
  INTERNAL_COMMIT_MARK,
  INTERNAL_COMMIT_THRESHOLD,
  addWeekItems,
  headingStart,
  keepItem,
  markInternalCommits,
  nothingToAnnounce,
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

/**
 * 커밋마다 「알아챌 변경인가」를 따로 판정해 내부 작업으로 보이는 커밋에 표시만 단다.
 * 빼지 않는다 — 화면이 생긴 커밋도 메시지가 문서 위주면 낮게 나온다.
 */
describe("내부 작업 표시", () => {
  const commits = ["- [10/13] feat: 채팅 태그", "- [10/14] test: DB 분리\n  본문", "- [10/15] feat: 시작 가이드"];

  it("기준선 아래 커밋에만 날짜 뒤에 표시를 단다", () => {
    const { lines, internal } = markInternalCommits(commits, [0.97, 0.01, INTERNAL_COMMIT_THRESHOLD]);
    expect(internal).toBe(1);
    expect(lines[0]).toBe(commits[0]);
    expect(lines[1]).toBe(`- [10/14] ${INTERNAL_COMMIT_MARK} test: DB 분리\n  본문`);
    // 기준선과 같으면 표시하지 않는다.
    expect(lines[2]).toBe(commits[2]);
  });

  it("판정이 없으면 표시하지 않는다 — 판정 실패나 AI_DECISIONS=off", () => {
    expect(markInternalCommits(commits, [])).toEqual({ lines: commits, internal: 0 });
    expect(markInternalCommits(commits, [null, 0.01, null]).internal).toBe(1);
  });

  it("모두 내부 작업으로 보이고 가이드 변경도 없을 때만 쓰지 않는다", () => {
    expect(nothingToAnnounce(3, 3, "")).toBe(true);
    expect(nothingToAnnounce(3, 3, "새 화면 안내")).toBe(false);
    expect(nothingToAnnounce(3, 2, "")).toBe(false);
    expect(nothingToAnnounce(0, 0, "")).toBe(false);
  });

  it("판정 답은 하나씩 검증한다 — 형식이 다른 답은 그 커밋만 버린다", () => {
    expect(commitPredicateAnswerSchema.safeParse({ type: "predicate", name: "c3", probability: 0.4 }).success).toBe(true);
    expect(commitPredicateAnswerSchema.safeParse({ type: "refusal", name: "c3" }).success).toBe(false);
    expect(commitPredicateAnswerSchema.safeParse({ type: "predicate", name: "c0", probability: 0.4 }).success).toBe(false);
    expect(commitPredicateAnswerSchema.safeParse({ type: "predicate", name: "c1", probability: 1.2 }).success).toBe(false);
  });
});
