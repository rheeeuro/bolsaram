/**
 * 로그인 뒤 돌아갈 경로 검증.
 *
 * `?next=` 는 외부에서 들어오는 값이다 — 절대 URL 이나 `//호스트` 를 그대로 쓰면
 * 로그인 화면이 열린 리다이렉터가 된다. 같은 출처의 경로만 통과시킨다.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/")) return null;
  // `//host` 와 `/\host` 는 브라우저가 다른 출처로 해석한다.
  if (next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}
