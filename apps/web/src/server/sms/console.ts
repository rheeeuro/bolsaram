/**
 * 개발용 sender. 실제로 보내지 않고 서버 콘솔에만 남긴다.
 *
 * 운영자가 `pnpm pm2:logs` 로 인증번호를 확인해 회원 흐름을 검증하는 용도다.
 * 로그는 호스트에 접근할 수 있는 사람만 보므로 네트워크로 새지 않는다
 * (응답에 코드를 싣는 것은 `DEV_EXPOSE_OTP` + loopback 배포에서만 — auth/login.ts).
 */
import "server-only";
import type { SmsMessage, SmsSender } from "./types";

export class ConsoleSmsSender implements SmsSender {
  readonly name = "console";
  /** 사용자 휴대폰에는 도착하지 않는다. */
  readonly delivers = false;

  async send(message: SmsMessage): Promise<void> {
    console.info(`[sms:console] ${message.to} ← ${message.text}`);
  }
}
