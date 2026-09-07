/**
 * SMS 발송 프로바이더 인터페이스.
 *
 * AI 추출과 같은 방식으로 추상화한다 — 구현체를 갈아끼울 수 있어야 하고,
 * 개발·테스트에서는 실제로 문자를 보내지 않는다.
 *
 * **본문에 인증번호 외의 개인정보를 넣지 않는다.** 발송 실패는 삼키지 않고
 * `DomainError` 로 올려 호출부가 사용자에게 이유를 알릴 수 있게 한다.
 */
import "server-only";

export type SmsMessage = {
  /** 수신 번호. 하이픈 없는 숫자만(`normalizePhone` 을 통과한 값). */
  to: string;
  text: string;
};

export type SmsSender = {
  readonly name: string;
  /**
   * 문자를 보낸다. 실패하면 던진다.
   * 실제로 사용자 휴대폰에 도착하는 경로인지는 `delivers` 로 구분한다 —
   * 콘솔 sender 처럼 도착하지 않는 구현이 운영에 올라가는 것을 막는 데 쓴다.
   */
  readonly delivers: boolean;
  send(message: SmsMessage): Promise<void>;
};
