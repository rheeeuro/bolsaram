/** 프로바이더 선택. AI_PROVIDER 환경변수 하나로 갈아끼운다. */
import "server-only";
import { env } from "../env";
import { MockExtractionProvider } from "./mock";
import { OpenAiExtractionProvider } from "./openai";
import type { ExtractionProvider } from "./types";

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

export * from "./types";
export { MockExtractionProvider } from "./mock";
