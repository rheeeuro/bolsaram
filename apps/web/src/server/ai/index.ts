/** 프로바이더 선택. AI_PROVIDER 환경변수 하나로 갈아끼운다. */
import "server-only";
import { env } from "../env";
import { MockExtractionProvider } from "./mock";
import { OpenAiFieldJudge } from "./decisions";
import { OpenAiExtractionProvider } from "./openai";
import type { ExtractionProvider, FieldJudge } from "./types";

let cached: ExtractionProvider | null = null;

export function extractionProvider(): ExtractionProvider {
  if (cached) return cached;
  cached =
    env().AI_PROVIDER === "openai"
      ? new OpenAiExtractionProvider()
      : new MockExtractionProvider();
  return cached;
}

/** 테스트에서 프로바이더를 갈아끼울 때 쓴다. */
export function setExtractionProvider(provider: ExtractionProvider | null): void {
  cached = provider;
}

let judgeOverride: FieldJudge | null | undefined;

/**
 * 열거형 항목 재판정기. openai 이고 AI_DECISIONS=on 일 때만 있다 —
 * mock 에는 없고, 그때는 추출이 매긴 신뢰도를 그대로 쓴다.
 */
export function fieldJudge(): FieldJudge | null {
  if (judgeOverride !== undefined) return judgeOverride;
  const config = env();
  return config.AI_PROVIDER === "openai" && config.AI_DECISIONS === "on"
    ? new OpenAiFieldJudge()
    : null;
}

/** 테스트에서 재판정기를 갈아끼울 때 쓴다. `undefined` 면 환경변수로 되돌린다. */
export function setFieldJudge(judge: FieldJudge | null | undefined): void {
  judgeOverride = judge;
}

export * from "./types";
export { MockExtractionProvider } from "./mock";
