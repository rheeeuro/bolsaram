/**
 * Node 런타임 기동 작업. `instrumentation.ts` 가 Node 에서만 이 모듈을 불러온다.
 *
 * 분리한 이유: `instrumentation.ts` 는 Edge 런타임에서도 평가되므로 번들러가
 * `node:*` 모듈을 정적으로 발견하면 경고를 낸다. Next 문서(`instrumentation.js`
 * 「Specifying the runtime」)가 안내하는 대로 런타임별 파일로 갈랐다.
 */
import "server-only";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { env, isLoopbackDeployment } from "./server/env";

/**
 * Node 의 Happy Eyeballs 는 주소 하나당 이 시간만 기다리고 다음 주소로 넘어간다.
 * 기본값 250ms 는 국내 CDN 기준이고 해외 API 에는 모자라다 —
 * `api.telegram.org`(암스테르담) TCP 연결이 260~266ms 라 **완료 직전에 취소되어**
 * `fetch` 가 ETIMEDOUT 으로 실패한다(같은 호스트에서 curl 은 이 제한이 없어 된다).
 *
 * 주소 선택 방식은 그대로 두고 대기 시간만 늘린다. 텔레그램 Bot API 와 OpenAI 등
 * 해외 프로바이더 호출 전부가 이 값에 걸린다.
 */
const CONNECT_ATTEMPT_TIMEOUT_MS = 2_000;

export function startup(): void {
  setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT_MS);

  // env() 는 lazy 라서 검증이 첫 요청까지 미뤄진다. 설정 실수(운영에서 OTP 노출,
  // 시크릿 누락 등)는 트래픽을 받기 전에 드러나야 하므로 여기서 강제로 평가한다.
  const config = env();
  const loopback = isLoopbackDeployment();
  console.info(
    `볼사람 서버 기동 — APP_ENV=${config.APP_ENV} (NODE_ENV=${config.NODE_ENV})` +
      ` / AI 프로바이더 ${config.AI_PROVIDER}` +
      (config.TELEGRAM_ENABLED ? " / 텔레그램 Import 켜짐" : "") +
      (config.DEV_EXPOSE_OTP ? ` / OTP 로그 출력${loopback ? " · 화면 표시" : ""}` : ""),
  );
  // 공개 주소인데 개발 편의 기능이 켜져 있으면 눈에 띄게 남긴다.
  // 코드가 응답에 실리는 것은 이미 막혀 있지만, 이 조합 자체가 정리 대상이다.
  if (config.DEV_EXPOSE_OTP && !loopback) {
    console.warn(
      "⚠️ 공개 주소 배포에서 DEV_EXPOSE_OTP 가 켜져 있습니다." +
        " 인증번호는 응답에 싣지 않고 서버 로그에만 남깁니다." +
        " SMS 연동 후 이 값을 지우세요.",
    );
  }
}
