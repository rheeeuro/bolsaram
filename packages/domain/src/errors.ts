/**
 * 도메인 오류. HTTP 레이어가 status 로 번역한다.
 * 에러를 삼키지 않기 위해 모든 도메인 위반은 이 타입으로 던진다.
 */
export type DomainErrorCode =
  "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "INVALID_STATE" | "VALIDATION" | "RATE_LIMITED";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    if (details) this.details = details;
  }
}

export const HTTP_STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  INVALID_STATE: 422,
  VALIDATION: 400,
  RATE_LIMITED: 429,
};

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
