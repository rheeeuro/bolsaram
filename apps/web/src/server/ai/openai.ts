/**
 * OpenAI multimodal + Structured Outputs 프로바이더.
 *
 * JSON Schema 는 packages/schemas 의 Zod 정의에서 생성한다(single source).
 * 모델이 스키마를 지키더라도 반환값은 반드시 Zod 로 다시 검증한 뒤에 쓴다.
 */
import "server-only";
import {
  extractionResultSchema,
  toStrictJsonSchema,
  type ExtractionResult,
} from "@bolsaram/schemas";
import { DomainError } from "@bolsaram/domain";
import { env } from "../env";
import {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  type ExtractionInput,
  type ExtractionOutput,
  type ExtractionProvider,
} from "./types";

const API_URL = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 60_000;

/**
 * 텍스트만 보낸다. 사진은 보내지 않는다 — `ExtractionInput` 주석 참고.
 * 이미지 파트를 아예 만들 수 없게 타입에서 뺐다.
 */
type ContentPart = { type: "text"; text: string };

export class OpenAiExtractionProvider implements ExtractionProvider {
  readonly name = "openai";

  async extract(input: ExtractionInput): Promise<ExtractionOutput> {
    const model = env().OPENAI_MODEL;
    const content: ContentPart[] = [];

    if (input.text && input.text.trim().length > 0) {
      content.push({
        type: "text",
        text: `아래는 카카오톡에서 받은 프로필 원문이다.\n\n---\n${input.text}\n---`,
      });
    } else {
      // 원문이 없으면 채울 근거가 없다. 사진은 보내지 않으므로 전부 null 이 나온다.
      content.push({
        type: "text",
        text: "프로필 원문 텍스트가 없다. 모든 항목을 null 로 두고 그 사실을 notes 에 남긴다.",
      });
    }

    const body = {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "bolsaram_profile_extraction",
          strict: true,
          schema: toStrictJsonSchema(),
        },
      },
      // temperature 를 보내지 않는다. GPT-5.6 계열은 기본값(1)만 허용하고
      // 다른 값을 주면 400 을 돌려준다. 추출의 일관성은 온도가 아니라
      // strict JSON Schema 와 "추론하지 말고 null" 규칙(SYSTEM_PROMPT)으로 확보한다.
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env().OPENAI_API_KEY ?? ""}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      // 네트워크/타임아웃. 원인을 감추지 않고 그대로 올린다.
      throw new DomainError("INVALID_STATE", "AI 분석 요청에 실패했습니다.", {
        cause: String(error),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // 응답 본문에 원문이 섞일 수 있으므로 status 만 남긴다(설계문서 §12).
      throw new DomainError("INVALID_STATE", "AI 분석 요청이 거절되었습니다.", {
        status: response.status,
      });
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) {
      throw new DomainError("INVALID_STATE", "AI 응답이 비어 있습니다.");
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (error) {
      throw new DomainError("INVALID_STATE", "AI 응답이 JSON 이 아닙니다.", {
        cause: String(error),
      });
    }

    // strict 모드라도 검증을 건너뛰지 않는다(부트스트랩 「품질 규칙」).
    const validated = extractionResultSchema.safeParse(parsedJson);
    if (!validated.success) {
      throw new DomainError("INVALID_STATE", "AI 응답이 스키마와 맞지 않습니다.", {
        issues: validated.error.issues.slice(0, 5).map((i) => i.path.join(".")),
      });
    }

    return {
      ...(validated.data satisfies ExtractionResult),
      model,
      promptVersion: PROMPT_VERSION,
      raw: parsedJson,
    };
  }
}
