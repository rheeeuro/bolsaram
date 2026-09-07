/**
 * AI 프로바이더 키가 살아 있는지 확인한다.
 *
 * 키를 바꾼 뒤 「제대로 들어갔나」를 확인할 방법이 필요해서 만들었다.
 * 환경 파일에서 직접 읽고 **키는 출력하지 않는다.**
 *
 *   pnpm ai:check
 */
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { loadDotEnv } from "../packages/db/src/cli/dotenv";

// 해외 API 는 TCP 연결이 250ms(Node 기본값)를 넘어 완료 직전에 취소된다.
// 앱은 startup-node.ts 에서 같은 값을 올린다 — 스크립트도 같은 제약을 받는다.
setDefaultAutoSelectFamilyAttemptTimeout(2_000);

loadDotEnv();

const provider = process.env.AI_PROVIDER ?? "mock";
const model = process.env.OPENAI_MODEL ?? "(미설정)";
const key = process.env.OPENAI_API_KEY;

if (provider !== "openai") {
  console.info(`AI_PROVIDER=${provider} — 외부 호출이 없습니다.`);
  process.exit(0);
}
if (!key) {
  console.error("✗ AI_PROVIDER=openai 인데 OPENAI_API_KEY 가 없습니다.");
  process.exit(1);
}

const response = await fetch("https://api.openai.com/v1/models", {
  headers: { authorization: `Bearer ${key}` },
  signal: AbortSignal.timeout(20_000),
}).catch(() => {
  console.error("✗ OpenAI 에 연결하지 못했습니다.");
  process.exit(1);
});

if (!response.ok) {
  // 키 자체는 절대 출력하지 않는다. 길이만으로 「안 읽혔나 / 틀렸나」를 가른다.
  console.error(`✗ 키가 거부되었습니다 (HTTP ${response.status}).`);
  console.error(`  읽어들인 키 길이: ${key.length}자`);
  process.exit(1);
}

const payload = (await response.json()) as { data?: { id: string }[] };
const ids = new Set((payload.data ?? []).map((m) => m.id));
console.info(`✓ 키 유효 — 모델 ${ids.size}개`);
console.info(
  ids.has(model)
    ? `✓ OPENAI_MODEL=${model} 사용 가능`
    : `✗ OPENAI_MODEL=${model} 을 이 키로 쓸 수 없습니다.`,
);
if (!ids.has(model)) process.exit(1);
