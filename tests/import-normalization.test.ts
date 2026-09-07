/** Import 정규화와 상태 기계 (부트스트랩 §12 「import normalization」). */
import { describe, expect, it } from "vitest";
import {
  DomainError,
  assertCommittable,
  assertImportTransition,
  missingRequiredFields,
  normalizeRawText,
  resequence,
  reviewFields,
  statusAfterExtraction,
} from "@bolsaram/domain";
import { emptyExtractedFields, type ExtractedFields } from "@bolsaram/schemas";

describe("normalizeRawText", () => {
  it("CRLF 를 LF 로 통일한다", () => {
    expect(normalizeRawText("가\r\n나\r다")).toBe("가\n나\n다");
  });

  it("카카오톡 말머리를 제거한다", () => {
    expect(normalizeRawText("[홍길동] [오후 3:12] 93년생입니다")).toBe("93년생입니다");
  });

  it("제로폭 문자를 제거한다", () => {
    expect(normalizeRawText("가​나﻿다")).toBe("가나다");
  });

  it("3줄 이상 빈 줄을 2줄로 줄인다", () => {
    expect(normalizeRawText("가\n\n\n\n나")).toBe("가\n\n나");
  });

  it("줄 끝 공백을 정리하고 전체를 트림한다", () => {
    // 줄 끝 공백은 각 줄에서 제거되고, 앞쪽 들여쓰기는 보존된다(첫 줄은 전체 트림으로 사라진다).
    expect(normalizeRawText("  가   \n  나  \n  ")).toBe("가\n  나");
  });

  it("말머리가 아닌 대괄호는 남긴다", () => {
    expect(normalizeRawText("[중요] 읽어주세요")).toBe("[중요] 읽어주세요");
  });
});

describe("resequence", () => {
  it("순서를 유지하며 0부터 다시 매긴다", () => {
    expect(resequence([{ order: 5 }, { order: 1 }, { order: 9 }])).toEqual([
      { order: 0 },
      { order: 1 },
      { order: 2 },
    ]);
  });
});

describe("assertImportTransition", () => {
  it("정상 경로를 허용한다", () => {
    expect(() => assertImportTransition("RECEIVED", "ANALYZING")).not.toThrow();
    expect(() => assertImportTransition("ANALYZING", "REVIEW_REQUIRED")).not.toThrow();
    expect(() => assertImportTransition("READY", "IMPORTED")).not.toThrow();
  });

  it("실패에서 재시도할 수 있다", () => {
    expect(() => assertImportTransition("FAILED", "ANALYZING")).not.toThrow();
  });

  it("등록 완료는 되돌릴 수 없다", () => {
    expect(() => assertImportTransition("IMPORTED", "ANALYZING")).toThrowError(DomainError);
  });

  it("분석 없이 바로 등록할 수 없다", () => {
    expect(() => assertImportTransition("RECEIVED", "IMPORTED")).toThrowError(
      /바꿀 수 없습니다/,
    );
  });

  it("같은 상태로의 전이는 무시한다", () => {
    expect(() => assertImportTransition("ANALYZING", "ANALYZING")).not.toThrow();
  });
});

describe("검토 판정", () => {
  const complete = (): ExtractedFields => ({
    ...emptyExtractedFields(),
    gender: "FEMALE",
    birthYear: 1993,
    residenceRegion: "SEOUL",
  });

  const highConfidence = (fields: ExtractedFields) =>
    Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, v == null ? 0 : 0.95]),
    ) as Record<string, number>;

  it("신뢰도가 높고 필수가 채워졌으면 READY", () => {
    const fields = complete();
    expect(statusAfterExtraction(fields, highConfidence(fields))).toBe("READY");
  });

  it("필수 필드가 비면 REVIEW_REQUIRED", () => {
    const fields = { ...complete(), gender: null };
    expect(statusAfterExtraction(fields, highConfidence(fields))).toBe("REVIEW_REQUIRED");
  });

  it("신뢰도가 낮으면 REVIEW_REQUIRED", () => {
    const fields = complete();
    expect(statusAfterExtraction(fields, { ...highConfidence(fields), birthYear: 0.4 })).toBe(
      "REVIEW_REQUIRED",
    );
  });

  it("값이 없는 선택 필드는 확인 대상이 아니다", () => {
    const fields = complete();
    const review = reviewFields(fields, highConfidence(fields));
    const mbti = review.find((r) => r.key === "mbti");
    expect(mbti?.needsAttention).toBe(false);
  });

  it("빈 배열은 값 없음으로 본다", () => {
    const fields = { ...complete(), hobbies: [] };
    const review = reviewFields(fields, highConfidence(fields));
    expect(review.find((r) => r.key === "hobbies")?.needsAttention).toBe(false);
  });

  it("필수 필드 목록을 정확히 알려준다", () => {
    expect(missingRequiredFields(emptyExtractedFields())).toEqual([
      "gender",
      "birthYear",
      "residenceRegion",
    ]);
    expect(missingRequiredFields(complete())).toEqual([]);
  });
});

describe("assertCommittable", () => {
  const fields: ExtractedFields = {
    ...emptyExtractedFields(),
    gender: "MALE",
    birthYear: 1990,
    residenceRegion: "SEOUL",
  };

  it("READY 상태에서 공개 등록이 가능하다", () => {
    expect(() => assertCommittable("READY", fields, { publish: true })).not.toThrow();
  });

  it("확인이 남았으면 비공개 등록만 가능하다", () => {
    expect(() => assertCommittable("REVIEW_REQUIRED", fields)).not.toThrow();
    expect(() => assertCommittable("REVIEW_REQUIRED", fields, { publish: true })).toThrowError(
      /바로 공개할 수 없습니다/,
    );
  });

  it("이미 등록된 세션은 거부한다", () => {
    expect(() => assertCommittable("IMPORTED", fields)).toThrowError(/이미 등록된/);
  });

  it("분석 전에는 등록할 수 없다", () => {
    expect(() => assertCommittable("ANALYZING", fields)).toThrowError(
      /검토가 끝나지 않았습니다/,
    );
  });

  it("필수 필드가 비면 거부한다", () => {
    const error = catchError(() => assertCommittable("READY", emptyExtractedFields()));
    expect((error as DomainError).details).toMatchObject({
      missing: ["gender", "birthYear", "residenceRegion"],
    });
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}
