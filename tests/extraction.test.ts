/** AI 추출 스키마 검증 (부트스트랩 §12 「extraction validation」). */
import { describe, expect, it } from "vitest";
import {
  BIRTH_YEAR_MAX,
  BIRTH_YEAR_MIN,
  EXTRACTED_FIELD_KEYS,
  emptyExtractedFields,
  extractedFieldsSchema,
  extractionResultSchema,
  toStrictJsonSchema,
} from "@bolsaram/schemas";
import { MockExtractionProvider } from "../apps/web/src/server/ai/mock";

const provider = new MockExtractionProvider();

describe("extractedFieldsSchema", () => {
  it("전 필드 null 을 허용한다 — 모르면 추론하지 않는다", () => {
    expect(extractedFieldsSchema.safeParse(emptyExtractedFields()).success).toBe(true);
  });

  it("범위를 벗어난 출생연도를 거부한다", () => {
    for (const year of [BIRTH_YEAR_MIN - 1, BIRTH_YEAR_MAX + 1, 1800]) {
      const result = extractedFieldsSchema.safeParse({
        ...emptyExtractedFields(),
        birthYear: year,
      });
      expect(result.success).toBe(false);
    }
  });

  it("비현실적인 키를 거부한다", () => {
    for (const height of [12, 300]) {
      expect(
        extractedFieldsSchema.safeParse({ ...emptyExtractedFields(), height }).success,
      ).toBe(false);
    }
  });

  it("정의되지 않은 열거형 값을 거부한다", () => {
    expect(
      extractedFieldsSchema.safeParse({ ...emptyExtractedFields(), gender: "OTHER" }).success,
    ).toBe(false);
    expect(
      extractedFieldsSchema.safeParse({ ...emptyExtractedFields(), mbti: "XXXX" }).success,
    ).toBe(false);
  });

  it("취미 개수 상한을 적용한다", () => {
    const many = Array.from({ length: 13 }, (_, i) => `취미${i}`);
    expect(
      extractedFieldsSchema.safeParse({ ...emptyExtractedFields(), hobbies: many }).success,
    ).toBe(false);
  });
});

describe("toStrictJsonSchema", () => {
  it("OpenAI strict 규격을 만족한다", () => {
    const schema = toStrictJsonSchema() as {
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, { additionalProperties?: boolean; required?: string[] }>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required.sort()).toEqual(["confidence", "fields", "notes"]);
    expect(schema.properties.fields?.additionalProperties).toBe(false);
    // 모든 필드가 required 여야 한다 — 모델이 빠뜨리지 못하게.
    expect(schema.properties.fields?.required?.sort()).toEqual(
      [...EXTRACTED_FIELD_KEYS].sort(),
    );
    expect(schema.properties.confidence?.additionalProperties).toBe(false);
  });

  it("strict 가 지원하지 않는 default 를 남기지 않는다", () => {
    expect(JSON.stringify(toStrictJsonSchema())).not.toContain('"default"');
  });
});

describe("MockExtractionProvider", () => {
  it("한국어 프로필 글에서 항목을 뽑는다", async () => {
    const result = await provider.extract({
      text: [
        "93년생 여자",
        "키 167cm",
        "직업: 마케터",
        "거주: 서울",
        "종교: 무교",
        "MBTI: ENFP",
        "비흡연",
        "취미: 러닝, 전시, 커피",
      ].join("\n"),
    });

    expect(result.fields.gender).toBe("FEMALE");
    expect(result.fields.birthYear).toBe(1993);
    expect(result.fields.height).toBe(167);
    expect(result.fields.residenceRegion).toBe("SEOUL");
    expect(result.fields.religion).toBe("NONE");
    expect(result.fields.mbti).toBe("ENFP");
    expect(result.fields.smoking).toBe("NONE");
    expect(result.fields.hobbies).toEqual(["러닝", "전시", "커피"]);
  });

  it("두 자리 연도를 세기까지 고려해 환산한다", async () => {
    const older = await provider.extract({ text: "87년생 남자" });
    expect(older.fields.birthYear).toBe(1987);
    const younger = await provider.extract({ text: "01년생 여자" });
    expect(younger.fields.birthYear).toBe(2001);
  });

  it("적히지 않은 값은 추론하지 않는다", async () => {
    const result = await provider.extract({ text: "안녕하세요 잘 부탁드립니다" });
    expect(result.fields.gender).toBeNull();
    expect(result.fields.birthYear).toBeNull();
    expect(result.fields.height).toBeNull();
    // 무엇이 비었는지 사람에게 알려준다.
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it("이름만으로 성별을 추측하지 않는다", async () => {
    const result = await provider.extract({ text: "이름은 지훈입니다" });
    expect(result.fields.gender).toBeNull();
  });

  it("원문이 없으면 아무 항목도 채우지 않고 붙여넣기를 안내한다", async () => {
    // 사진은 모델에 보내지 않으므로(ai/types.ts) 원문이 유일한 근거다.
    const result = await provider.extract({ text: null });
    expect(result.notes.join(" ")).toContain("붙여넣어");
    expect(Object.values(result.fields).every((v) => v === null)).toBe(true);
  });

  it("출력이 항상 스키마를 통과한다", async () => {
    const samples = [
      "93년생 여자 키 167",
      "",
      "완전히 관계없는 문장입니다",
      "999년생 키 999cm",
      "취미: " + "가".repeat(500),
    ];
    for (const text of samples) {
      const result = await provider.extract({ text });
      expect(extractionResultSchema.safeParse(result).success).toBe(true);
    }
  });

  it("범위를 벗어난 값은 null 로 떨군다", async () => {
    const result = await provider.extract({ text: "1800년생 키 999cm" });
    expect(result.fields.birthYear).toBeNull();
    expect(result.fields.height).toBeNull();
  });

  it("같은 입력에 같은 결과를 낸다 (결정적)", async () => {
    const text = "90년생 남자 키 180 IT 개발자 서울";
    const a = await provider.extract({ text });
    const b = await provider.extract({ text });
    expect(a.fields).toEqual(b.fields);
  });
});
