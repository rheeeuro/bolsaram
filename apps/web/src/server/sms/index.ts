/**
 * sender 선택. `SMS_PROVIDER` 환경변수 하나로 갈아끼운다.
 *
 * 실제 업체 어댑터는 아직 없다 — 발신번호 사전등록과 계약이 필요하고, 검증하지 않은
 * 외부 API 를 추측으로 구현하지 않는다(카카오·텔레그램에서 같은 규칙을 적용했다).
 * 업체가 정해지면 `SmsSender` 를 구현한 파일 하나를 추가하고 여기에 분기를 넣는다.
 */
import "server-only";
import { env } from "../env";
import { ConsoleSmsSender } from "./console";
import type { SmsSender } from "./types";

let cached: SmsSender | null = null;

export function smsSender(): SmsSender {
  if (cached) return cached;
  switch (env().SMS_PROVIDER) {
    case "console":
      cached = new ConsoleSmsSender();
      break;
  }
  return cached;
}

export type { SmsMessage, SmsSender } from "./types";
export { ConsoleSmsSender } from "./console";
