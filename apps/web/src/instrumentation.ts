/**
 * 서버 기동 훅. 환경변수를 여기서 한 번 검증한다.
 *
 * `env()` 는 lazy 라서 검증이 첫 요청까지 미뤄진다. 설정 실수(운영에서 OTP 노출,
 * 시크릿 누락 등)는 트래픽을 받기 전에 드러나야 하므로 기동 시점에 강제로 평가한다.
 */
export async function register(): Promise<void> {
  // Edge 런타임에는 Node 전용 모듈이 없다. Node 런타임에서만 검사한다.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("./server/env");
  const config = env();
  console.info(
    `볼사람 서버 기동 — ${config.NODE_ENV} / AI 프로바이더 ${config.AI_PROVIDER}` +
      (config.DEV_EXPOSE_OTP ? " / OTP 노출(개발 전용)" : ""),
  );
}
