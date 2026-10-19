/**
 * OpenAI Decisions API — 값을 뽑지 않고 확률만 받는 판정 두 가지.
 *
 *   OpenAiFieldJudge         열거형 항목 재판정 → 검토 화면의 「확인 필요」(`calibrateConfidence`)
 *   OpenAiContinuationJudge  텔레그램으로 이어 온 글이 다른 사람의 소개인가 → 나누기 버튼
 *
 * 값은 추출(Structured Outputs)과 사람이 정한다. 입력은 원문 텍스트뿐이다 — 사진은 보내지 않는다.
 */
import "server-only";
import { z } from "zod";
import {
  DomainError,
  JUDGED_FIELDS,
  type FieldJudgement,
  type JudgedField,
} from "@bolsaram/domain";
import {
  DRINKING_LABELS,
  GENDER_LABELS,
  JOB_CATEGORY_LABELS,
  REGION_LABELS,
  RELIGION_LABELS,
  SMOKING_LABELS,
} from "@bolsaram/schemas";
import { env } from "../env";
import type {
  ContinuationJudge,
  ExtractionInput,
  FieldJudge,
  FieldJudgeOutput,
} from "./types";

const API_URL = "https://api.openai.com/v1/decisions";
const TIMEOUT_MS = 30_000;

/** 「원문에 적혀 있지 않다」 보기. 열거형 값(`NONE` = 비흡연 등)과 겹치지 않게 따로 둔다. */
const NOT_STATED = "NOT_STATED";

const QUESTIONS: Record<JudgedField, { instructions: string; labels: Record<string, string> }> = {
  gender: {
    instructions:
      "프로필 주인공의 성별. 원문에 성별이 드러나게 적혀 있을 때만 고른다. 이름·닉네임·직업·취미만으로는 고르지 않는다.",
    labels: GENDER_LABELS,
  },
  jobCategory: {
    instructions: "프로필 주인공의 직업이 속한 직업군. 직업이 적혀 있지 않으면 고르지 않는다.",
    labels: JOB_CATEGORY_LABELS,
  },
  residenceRegion: {
    instructions:
      "프로필 주인공이 사는 광역 지역. 동네·구·시로 적혀 있으면 그곳이 속한 광역이다. 직장 위치는 보지 않는다.",
    labels: REGION_LABELS,
  },
  workplaceRegion: {
    instructions: "프로필 주인공의 직장이 있는 광역 지역. 회사·근무지 위치가 적혀 있을 때만 고른다.",
    labels: REGION_LABELS,
  },
  religion: {
    instructions: "프로필 주인공 본인의 종교. 이상형에 적힌 종교 조건은 보지 않는다.",
    labels: RELIGION_LABELS,
  },
  smoking: {
    instructions: "프로필 주인공 본인의 흡연 여부. 이상형에 적힌 흡연 조건은 보지 않는다.",
    labels: SMOKING_LABELS,
  },
  drinking: {
    instructions: "프로필 주인공 본인의 음주 정도. 이상형에 적힌 음주 조건은 보지 않는다.",
    labels: DRINKING_LABELS,
  },
};

const choiceAnswerSchema = z.object({
  type: z.literal("choice"),
  name: z.string(),
  choice: z.string(),
  probabilities: z.array(z.object({ value: z.string(), probability: z.number().min(0).max(1) })),
});
const predicateAnswerSchema = z.object({
  type: z.literal("predicate"),
  name: z.string(),
  probability: z.number().min(0).max(1),
});
const answerSchema = z.union([
  choiceAnswerSchema,
  predicateAnswerSchema,
  // 거절은 그 항목만 판정 없이 둔다.
  z.object({ type: z.literal("refusal") }).loose(),
]);
const responseSchema = z.object({
  model: z.string(),
  answers: z.array(answerSchema),
});

function isJudgedField(name: string): name is JudgedField {
  return (JUDGED_FIELDS as readonly string[]).includes(name);
}

/** 응답 한 항목을 판정으로 옮긴다. 보기 밖의 값이 섞였으면 그 항목은 쓰지 않는다. */
function toJudgement(
  field: JudgedField,
  answer: z.infer<typeof choiceAnswerSchema>,
): FieldJudgement | null {
  const allowed = new Set([...Object.keys(QUESTIONS[field].labels), NOT_STATED]);
  if (!allowed.has(answer.choice) || answer.probabilities.some((p) => !allowed.has(p.value))) {
    return null;
  }
  const value = (v: string) => (v === NOT_STATED ? null : v);
  return {
    choice: value(answer.choice),
    probabilities: answer.probabilities.map((p) => ({
      value: value(p.value),
      probability: p.probability,
    })),
  };
}

/** `/v1/decisions` 한 번 호출하고 응답을 검증한다. 원문이 섞일 수 있어 오류에는 status 만 싣는다. */
async function requestDecisions(body: {
  input: string;
  questions: unknown[];
}): Promise<z.infer<typeof responseSchema>> {
  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env().OPENAI_API_KEY ?? ""}`,
      },
      body: JSON.stringify({ model: env().OPENAI_DECISIONS_MODEL, ...body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new DomainError("INVALID_STATE", "AI 판정 요청에 실패했습니다.", {
      cause: String(error),
    });
  }
  if (!response.ok) {
    throw new DomainError("INVALID_STATE", "AI 판정 요청이 거절되었습니다.", {
      status: response.status,
    });
  }

  const validated = responseSchema.safeParse(await response.json());
  if (!validated.success) {
    throw new DomainError("INVALID_STATE", "AI 판정 응답이 형식과 맞지 않습니다.", {
      issues: validated.error.issues.slice(0, 5).map((i) => i.path.join(".")),
    });
  }
  return validated.data;
}

export class OpenAiFieldJudge implements FieldJudge {
  async judge(input: ExtractionInput): Promise<FieldJudgeOutput> {
    if (!input.text?.trim()) return { model: env().OPENAI_DECISIONS_MODEL, judgements: {} };

    const data = await requestDecisions({
      input: input.text,
      questions: JUDGED_FIELDS.map((field) => ({
        type: "choice",
        name: field,
        instructions: QUESTIONS[field].instructions,
        choices: [
          ...Object.entries(QUESTIONS[field].labels).map(([value, label]) => ({
            value,
            description: label,
          })),
          { value: NOT_STATED, description: "원문에 적혀 있지 않다" },
        ],
      })),
    });

    const judgements: FieldJudgeOutput["judgements"] = {};
    for (const answer of data.answers) {
      if (answer.type !== "choice" || !isJudgedField(answer.name)) continue;
      const judgement = toJudgement(answer.name, answer);
      if (judgement) judgements[answer.name] = judgement;
    }
    return { model: data.model, judgements };
  }
}

const DIFFERENT_PERSON = "different_person";

/**
 * 텔레그램으로 이어 온 글이 다른 사람의 소개인지. 결과는 묻기만 한다 — 나누는 것은
 * 주선자가 버튼을 눌렀을 때다. 거절하거나 답이 없으면 0(같은 사람으로 본다)이다.
 */
export class OpenAiContinuationJudge implements ContinuationJudge {
  async differentPerson(input: { previous: string; incoming: string }): Promise<number> {
    const data = await requestDecisions({
      input: `[앞 글]\n${input.previous}\n\n[새 글]\n${input.incoming}`,
      questions: [
        {
          type: "predicate",
          name: DIFFERENT_PERSON,
          instructions:
            "주선자가 소개팅 프로필을 메시지 여러 개로 나눠 보낸다. [새 글]이 [앞 글]과 **다른 사람**을 소개하는 글이면 참이다. 같은 사람의 소개를 이어 쓰거나(이상형·자기소개 등) 고치는 글이면 거짓이다.",
        },
      ],
    });
    const answer = data.answers.find(
      (a): a is z.infer<typeof predicateAnswerSchema> =>
        a.type === "predicate" && a.name === DIFFERENT_PERSON,
    );
    return answer?.probability ?? 0;
  }
}
