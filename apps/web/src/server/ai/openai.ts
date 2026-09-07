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
/** 이미지가 많으면 비용과 지연이 커진다. 앞쪽 몇 장만 보낸다. */
const MAX_IMAGES = 4;

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "low" | "high" } };

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
      content.push({
        type: "text",
        text: "프로필 원문 텍스트가 없다. 이미지에서 읽을 수 있는 것만 채우고 나머지는 null 로 둔다.",
      });
    }

    for (const image of input.images.slice(0, MAX_IMAGES)) {
      content.push({
        type: "image_url",
        image_url: {
          // data URL 로 보낸다 — private 스토리지의 signed URL 을 외부에 넘기지 않는다.
          url: `data:${image.mimeType};base64,${image.data.toString("base64")}`,
          detail: "low",
        },
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
      temperature: 0,
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
