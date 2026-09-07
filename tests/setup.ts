/** 테스트 공통 설정. 리포 루트의 .env 를 읽어 DB 연결 정보를 채운다. */
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
for (const file of [".env", ".env.local"]) {
  const full = path.join(root, file);
  if (existsSync(full)) process.loadEnvFile(full);
}

/**
 * 테스트는 외부 모델을 호출하지 않는다.
 *
 * `analyzeSession` 은 `AI_PROVIDER` 를 보고 프로바이더를 고르므로, 개발자 `.env` 가
 * `openai` 로 설정돼 있으면 통합 테스트가 **실제 유료 API 를 호출한다.** 느려지는 것은
 * 물론이고 결과가 매번 달라져 단정할 수 없고, 픽스처의 프로필 원문이 외부로 나간다.
 * 여기서 mock 으로 고정한다 — 프로바이더 선택 자체는 `extraction.test.ts` 가 검증한다.
 */
process.env.AI_PROVIDER = "mock";
delete process.env.OPENAI_API_KEY;
