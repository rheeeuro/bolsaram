/**
 * OpenAI Decisions API 로 열거형 항목을 다시 판정한다.
 *
 * 추출(Structured Outputs)이 값을 정하고, 여기서는 같은 원문을 보고 보기마다의 확률만
 * 받는다. 그 확률로 검토 화면의 「확인 필요」를 정한다(`calibrateConfidence`).
 * 입력은 추출과 같은 원문 텍스트뿐이다 — 사진은 보내지 않는다.
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
import type { ExtractionInput, FieldJudge, FieldJudgeOutput } from "./types";

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
const answerSchema = z.union([
  choiceAnswerSchema,
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

export class OpenAiFieldJudge implements FieldJudge {
  async judge(input: ExtractionInput): Promise<FieldJudgeOutput> {
    const model = env().OPENAI_DECISIONS_MODEL;
    if (!input.text?.trim()) return { model, judgements: {} };

    const body = {
      model,
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
    };

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env().OPENAI_API_KEY ?? ""}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new DomainError("INVALID_STATE", "AI 판정 요청에 실패했습니다.", {
        cause: String(error),
      });
    }
    if (!response.ok) {
      // 응답 본문에 원문이 섞일 수 있으므로 status 만 남긴다.
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

    const judgements: FieldJudgeOutput["judgements"] = {};
    for (const answer of validated.data.answers) {
      if (answer.type !== "choice" || !isJudgedField(answer.name)) continue;
      const judgement = toJudgement(answer.name, answer);
      if (judgement) judgements[answer.name] = judgement;
    }
    return { model: validated.data.model, judgements };
  }
}
