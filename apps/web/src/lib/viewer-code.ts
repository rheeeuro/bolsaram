/**
 * 워터마크에 찍는 「보는 사람」 표기와 그 판독.
 *
 * 서버의 워터마크 합성(`server/storage/watermark.ts`)과 주선자 화면의 캡처본 확인이 같은
 * 규칙을 써야 하므로 한 곳에 둔다.
 *
 *   멤버     `No.17`      공개 번호. 프로필 찾기에 그대로 넣는다.
 *   주선자   `H-8F3A2C`   계정 id 앞 여섯 자리. 주선자에게는 공개 번호가 없다.
 *
 * 서버 글꼴에 한글이 없으므로 ASCII 만 쓴다.
 */

const HOST_CODE_LENGTH = 6;

export function memberViewerCode(publicCode: number | null, userId: string): string {
  return publicCode != null ? `No.${publicCode}` : `U-${userId.slice(0, 8)}`;
}

export function hostViewerCode(userId: string): string {
  return `H-${userId.replaceAll("-", "").slice(0, HOST_CODE_LENGTH).toUpperCase()}`;
}

export type TraceCode = { kind: "member"; publicCode: number } | { kind: "host"; prefix: string };

/**
 * 판독한 글자 → 누구인가. `17` · `No.17` · `17번` 은 멤버, `H-8F3A2C` · `h8f3a2c` 는 주선자.
 * 날짜까지 함께 붙여 넣어도 앞의 표기만 본다.
 */
export function parseTraceCode(input: string): TraceCode | null {
  const text = input.trim();
  const host = /^h\s*-?\s*([0-9a-f]{6})/i.exec(text);
  if (host) return { kind: "host", prefix: host[1]!.toLowerCase() };
  const member = /^(?:no\.?\s*)?(\d{1,7})/i.exec(text);
  if (member) return { kind: "member", publicCode: Number(member[1]) };
  return null;
}
