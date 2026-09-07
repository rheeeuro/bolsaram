/**
 * API 라우트 공통 응답 처리.
 * 도메인 오류를 status 로 번역하고, 예상 못 한 오류는 서버에만 남기고
 * 클라이언트에는 일반 메시지를 준다(설계문서 §12 로그 최소화).
 */
import "server-only";
import { NextResponse } from "next/server";
import { HTTP_STATUS_BY_CODE, isDomainError } from "@bolsaram/domain";
import { z } from "zod";

export type ApiError = { error: { code: string; message: string; details?: unknown } };

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function fail(code: string, message: string, status: number, details?: unknown) {
  const body: ApiError = { error: { code, message, ...(details ? { details } : {}) } };
  return NextResponse.json(body, { status });
}

export function handleError(error: unknown): NextResponse {
  if (isDomainError(error)) {
    // 로그인 필요는 403 이 아니라 401 로 내려야 클라이언트가 로그인으로 보낸다.
    const status =
      error.code === "FORBIDDEN" && error.message.includes("로그인")
        ? 401
        : HTTP_STATUS_BY_CODE[error.code];
    return fail(error.code, error.message, status, error.details);
  }
  if (error instanceof z.ZodError) {
    return fail("VALIDATION", "입력값이 올바르지 않습니다.", 400, {
      issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  console.error("처리하지 못한 오류", error);
  return fail("INTERNAL", "요청을 처리하지 못했습니다.", 500);
}

/** 라우트 핸들러를 감싸 오류 처리를 일원화한다. */
export function route<A extends unknown[]>(
  handler: (...args: A) => Promise<NextResponse>,
): (...args: A) => Promise<NextResponse> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (error) {
      return handleError(error);
    }
  };
}

/** JSON 본문을 스키마로 검증해 읽는다. */
export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new z.ZodError([{ code: "custom", path: [], message: "JSON 본문이 필요합니다." }]);
  }
  return schema.parse(raw);
}

/** 쿼리스트링을 스키마로 검증해 읽는다. 같은 키가 여러 번 오면 배열로 넘긴다. */
export function readQuery<T>(request: Request, schema: z.ZodType<T>): T {
  const params = new URL(request.url).searchParams;
  const record: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    record[key] = all.length > 1 ? all : all[0]!;
  }
  return schema.parse(record);
}
