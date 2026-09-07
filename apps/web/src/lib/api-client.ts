/**
 * 클라이언트 fetch 래퍼.
 * 서버 오류 형식({ error: { code, message } })을 한 곳에서 풀어 UI 가 메시지만 쓰게 한다.
 * 오류를 삼키지 않고 항상 판별 가능한 결과를 돌려준다.
 */
export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; code: string; message: string; status: number };

async function request<T>(method: string, url: string, body?: unknown): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: "NETWORK", message: "네트워크에 연결할 수 없습니다.", status: 0 };
  }

  if (response.status === 204) return { ok: true, data: undefined as T };

  let payload: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    return {
      ok: false,
      code: error?.code ?? "UNKNOWN",
      message: error?.message ?? "요청을 처리하지 못했습니다.",
      status: response.status,
    };
  }
  return { ok: true, data: payload as T };
}

export const apiGet = <T>(url: string) => request<T>("GET", url);
export const apiPost = <T = unknown>(url: string, body?: unknown) =>
  request<T>("POST", url, body);
export const apiPatch = <T = unknown>(url: string, body?: unknown) =>
  request<T>("PATCH", url, body);
export const apiPut = <T = unknown>(url: string, body?: unknown) =>
  request<T>("PUT", url, body);
export const apiDelete = <T = unknown>(url: string, body?: unknown) =>
  request<T>("DELETE", url, body);

/** 파일 직접 업로드. signed upload URL 로 PUT 한다. */
export async function uploadFile(
  url: string,
  file: File,
): Promise<ApiResult<{ size: number }>> {
  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": file.type },
      body: file,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      return {
        ok: false,
        code: payload?.error?.code ?? "UPLOAD",
        message: payload?.error?.message ?? "업로드에 실패했습니다.",
        status: response.status,
      };
    }
    return { ok: true, data: (await response.json()) as { size: number } };
  } catch {
    return { ok: false, code: "NETWORK", message: "업로드 중 연결이 끊겼습니다.", status: 0 };
  }
}
