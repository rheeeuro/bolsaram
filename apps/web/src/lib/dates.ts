/**
 * 화면에 시각을 적는 규칙. 서버 컴포넌트와 클라이언트 컴포넌트가 같은 글자를 내야
 * 하이드레이션이 어긋나지 않으므로 시간대를 서울로 못박는다.
 */
const TIME_ZONE = "Asia/Seoul";

/** 서울 기준 날짜 키(YYYY-MM-DD). 「오늘인가」를 시간대와 무관하게 판정한다. */
function dayKey(at: Date): string {
  return at.toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

/** 오늘이면 시각만, 다른 날이면 날짜까지. 대화 화면과 같은 규칙이다. */
export function formatWhen(iso: string): string {
  const at = new Date(iso);
  const sameDay = dayKey(at) === dayKey(new Date());
  return at.toLocaleString("ko-KR", {
    timeZone: TIME_ZONE,
    ...(sameDay ? {} : { year: "2-digit", month: "numeric", day: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 목록처럼 좁은 자리에 쓰는 날짜. 오늘이면 「오늘」, 올해면 연도를 뺀다. */
export function formatDay(iso: string): string {
  const at = new Date(iso);
  const today = dayKey(new Date());
  const key = dayKey(at);
  if (key === today) return "오늘";
  return at.toLocaleDateString("ko-KR", {
    timeZone: TIME_ZONE,
    ...(key.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
    month: "long",
    day: "numeric",
  });
}

/** 상세 화면처럼 한 번만 적는 자리. 연도까지 다 적는다. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
