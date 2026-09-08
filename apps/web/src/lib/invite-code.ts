/**
 * 입장코드 정규화.
 *
 * 입장코드는 초대 링크의 토큰과 같은 값이다(base64url 43자). 카카오톡에서 옮겨오는
 * 과정에서 링크 전체나 앞뒤 공백이 함께 붙는 일이 많아, 화면에 넣기 전에 여기서
 * 코드만 뽑아낸다. 유효성(만료·재사용) 판정은 서버 한 곳에만 있다.
 */
const MARKER = "/claim/";

export function extractInviteCode(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const at = value.lastIndexOf(MARKER);
  const token = at >= 0 ? value.slice(at + MARKER.length) : value;
  // 링크 뒤에 붙은 쿼리·해시·경로와 중간에 끼어든 공백을 잘라낸다.
  const cleaned = token.split(/[?#/\s]/)[0] ?? "";
  if (!cleaned) return null;

  // 링크에서 뽑은 값은 인코딩돼 있을 수 있다. 실패하면 원문을 그대로 쓴다.
  try {
    return decodeURIComponent(cleaned);
  } catch {
    return cleaned;
  }
}
