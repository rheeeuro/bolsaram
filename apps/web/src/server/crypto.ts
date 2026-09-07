/** 서명/해시 유틸. 비밀은 전부 env 에서만 읽는다. */
import "server-only";
import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

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

/** 6자리 숫자 OTP. Math.random 을 쓰지 않는다. */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * 비밀번호 해시. scrypt 를 쓰고 salt 를 함께 저장한다.
 * 형식: `scrypt$<N>$<salt>$<hash>`
 */
const SCRYPT_COST = 16384;
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize("NFKC"), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
  });
  return `scrypt$${SCRYPT_COST}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const cost = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  if (!Number.isInteger(cost) || !salt || !expected) return false;
  const actual = scryptSync(
    password.normalize("NFKC"),
    Buffer.from(salt, "base64url"),
    SCRYPT_KEYLEN,
    {
      N: cost,
    },
  ).toString("base64url");
  return safeEqual(actual, expected);
}
