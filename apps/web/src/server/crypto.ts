/** 서명/해시 유틸. 비밀은 전부 env 에서만 읽는다. */
import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** base64url — 쿠키·URL 에 그대로 넣을 수 있는 형태. */
export function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function hmac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** 길이가 달라도 타이밍 정보를 흘리지 않도록 항상 같은 길이로 비교한다. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // 길이 비교 자체는 어쩔 수 없지만, 내용 비교는 하지 않고 즉시 실패시킨다.
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes));
}

/** 초대 토큰/OTP 처럼 원문을 저장하면 안 되는 값의 해시. pepper 를 섞는다. */
export function peppered(secret: string, value: string): string {
  return hmac(secret, value);
}

/**
 * PKCE code_challenge. `S256` 은 verifier 의 SHA-256 을 base64url 로 적는다.
 *
 * 카카오는 client_secret 을 콘솔에서 켤 때만 주므로, 인가 코드를 가로챈 쪽이 그대로
 * 교환하는 것을 막아 주는 것이 이 값뿐일 수 있다.
 */
export function sha256b64url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}
