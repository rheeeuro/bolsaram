/**
 * 서버 환경변수. 시작 시 한 번 검증하고, 이후에는 이 모듈만 참조한다.
 * 클라이언트 번들에 새어 나가면 안 되므로 이 파일은 server-only 로 표시한다.
 */
import "server-only";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.string().url().default("http://127.0.0.1:3020"),

  SESSION_SECRET: z.string().min(32, "SESSION_SECRET 은 32자 이상이어야 합니다."),
  STORAGE_SECRET: z.string().min(32, "STORAGE_SECRET 은 32자 이상이어야 합니다."),
  INVITE_TOKEN_PEPPER: z.string().min(32, "INVITE_TOKEN_PEPPER 는 32자 이상이어야 합니다."),

  STORAGE_ROOT: z.string().min(1).default("./var/storage"),
  STORAGE_SIGNED_URL_TTL: z.coerce.number().int().min(30).max(3600).default(300),

  AI_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5.6-luna"),

  /**
   * 텔레그램 Import 채널. 기본은 꺼져 있고, 꺼져 있으면 webhook 이 404 를 준다.
   * 봇 토큰이 없는 환경(테스트·CI)에서 라우트가 살아 있으면 오히려 위험하다.
   */
  TELEGRAM_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  /** @BotFather 가 발급한 토큰. 로그에 남기지 않는다. */
  TELEGRAM_BOT_TOKEN: z.string().min(20).optional(),
  /**
   * setWebhook 의 secret_token. 텔레그램이 매 요청에
   * `X-Telegram-Bot-Api-Secret-Token` 헤더로 되돌려주고, 우리는 그 값으로 발신자를
   * 확인한다. Bot API 가 허용하는 문자는 A-Z a-z 0-9 _ - 뿐이다.
   */
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .min(32, "TELEGRAM_WEBHOOK_SECRET 은 32자 이상이어야 합니다.")
    .max(256)
    .regex(/^[A-Za-z0-9_-]+$/, "TELEGRAM_WEBHOOK_SECRET 에는 A-Z a-z 0-9 _ - 만 쓸 수 있습니다.")
    .optional(),

  DEV_EXPOSE_OTP: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  /**
   * 배포 환경. NODE_ENV 와 분리한 축이다.
   *
   * PM2 로 띄우면 NODE_ENV 는 항상 production 이지만, 이 호스트의 인스턴스는 아직
   * 실제 사용자를 받지 않는 로컬 스테이징이다. 두 축을 섞으면 "빌드 최적화를 켜려면
   * 회원 로그인을 포기해야 하는" 상황이 된다.
   *
   * production 으로 두면 개발 편의 기능이 전부 잠긴다. 실제 배포에서는 반드시 이 값을 쓴다.
   */
  APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`환경변수 설정이 잘못되었습니다:\n${lines.join("\n")}`);
  }
  if (parsed.data.AI_PROVIDER === "openai" && !parsed.data.OPENAI_API_KEY) {
    throw new Error("AI_PROVIDER=openai 이면 OPENAI_API_KEY 가 필요합니다.");
  }
  // 반쯤 켜진 상태를 허용하지 않는다. 토큰 없이 webhook 만 열리면 검증도 못 하고
  // 답장도 못 하는 채널이 생긴다.
  if (parsed.data.TELEGRAM_ENABLED) {
    if (!parsed.data.TELEGRAM_BOT_TOKEN) {
      throw new Error("TELEGRAM_ENABLED=true 이면 TELEGRAM_BOT_TOKEN 이 필요합니다.");
    }
    if (!parsed.data.TELEGRAM_WEBHOOK_SECRET) {
      throw new Error("TELEGRAM_ENABLED=true 이면 TELEGRAM_WEBHOOK_SECRET 이 필요합니다.");
    }
  }
  // OTP 노출은 실제 운영에서 절대 허용하지 않는다.
  // 판정 기준은 NODE_ENV 가 아니라 APP_ENV 다 — PM2 로 띄운 로컬 스테이징도
  // NODE_ENV 는 production 이지만 아직 실제 사용자가 없다.
  if (parsed.data.APP_ENV === "production" && parsed.data.DEV_EXPOSE_OTP) {
    throw new Error("APP_ENV=production 에서는 DEV_EXPOSE_OTP 를 켤 수 없습니다.");
  }
  cached = parsed.data;
  return cached;
}

/** 쿠키 secure 플래그 등 런타임 동작 판정용. */
export function isProduction(): boolean {
  return env().NODE_ENV === "production";
}

/** 실제 사용자를 받는 배포인지. 개발 편의 기능의 허용 여부는 이 값으로 판단한다. */
export function isLiveDeployment(): boolean {
  return env().APP_ENV === "production";
}

/** 텔레그램 Import 채널이 켜져 있는지. 라우트와 관리자 화면이 함께 이 값을 본다. */
export function isTelegramEnabled(): boolean {
  return env().TELEGRAM_ENABLED;
}

/**
 * 이 배포가 자기 호스트 밖에서 접근 가능한지 — `APP_ORIGIN` 이 loopback 인지로 판정한다.
 *
 * 개발 편의 기능 중 **네트워크로 값을 흘리는 것**은 이 값으로 막는다. `APP_ENV` 만으로는
 * 부족하다 — 이 호스트는 APP_ENV=staging 인데 실제로는 공개 도메인으로 서비스되고 있었고,
 * 그 상태에서 로그인 인증번호가 API 응답에 실려 누구나 남의 계정으로 로그인할 수 있었다.
 * 사람이 플래그를 옳게 설정하는 데 기대지 않고 주소에서 유도한다.
 */
export function isLoopbackDeployment(): boolean {
  try {
    const host = new URL(env().APP_ORIGIN).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
  } catch {
    // 파싱할 수 없으면 공개로 간주한다 — 안전한 쪽으로 틀린다.
    return false;
  }
}
