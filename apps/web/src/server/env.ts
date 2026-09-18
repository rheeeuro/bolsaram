/**
 * 서버 환경변수. 시작 시 한 번 검증하고, 이후에는 이 모듈만 참조한다.
 * 클라이언트 번들에 새어 나가면 안 되므로 이 파일은 server-only 로 표시한다.
 */
import "server-only";
import { validateStorageConfig } from "@bolsaram/db/r2";
import type { OAuthProvider } from "@bolsaram/schemas";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.string().url().default("http://127.0.0.1:3020"),

  SESSION_SECRET: z.string().min(32, "SESSION_SECRET 은 32자 이상이어야 합니다."),
  STORAGE_SECRET: z.string().min(32, "STORAGE_SECRET 은 32자 이상이어야 합니다."),
  INVITE_TOKEN_PEPPER: z.string().min(32, "INVITE_TOKEN_PEPPER 는 32자 이상이어야 합니다."),

  STORAGE_PROVIDER: z.enum(["local", "r2"]).default("local"),
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

  /**
   * 주선자 로그인 — 카카오·구글 OAuth.
   *
   * 제공자마다 따로 켜진다. 키가 없으면 그 버튼이 화면에 뜨지 않는다(전부 없으면
   * 아무도 로그인할 수 없으므로 기동 시 경고한다). 비밀번호를 우리가 보관하지 않으니
   * 이 값들이 유일한 인증 경로다 — 로그에 남기지 않는다.
   *
   * 카카오는 「REST API 키」가 client_id 이고 client_secret 은 콘솔에서 켤 때만 생긴다.
   * 구글은 둘 다 필수다.
   */
  KAKAO_CLIENT_ID: z.string().min(1).optional(),
  KAKAO_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

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

/**
 * 아래 검증에 걸리면 `instrumentation` 훅이 던지고 **앱이 아무것도 서비스하지 않는다** —
 * 포트는 열리지만 모든 요청이 500 이다(프로세스는 죽지 않으므로 `pm2 status` 는
 * online 으로 보인다). 설정 변경 후에는 상태가 아니라 기동 로그를 확인한다.
 */
export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  validateStorageConfig(process.env);
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
  // production 은 실제 사용자를 받는 배포다. 여기서 걸러야 할 설정 실수가 있다.
  if (parsed.data.APP_ENV === "production") {
    // 초대 링크·봇 검토 버튼이 이 주소로 나간다. loopback 이면 회원에게 보낸 링크가
    // 열리지 않는다(실제로 이 호스트에서 한 번 겪었다).
    if (!parsed.data.APP_ORIGIN.startsWith("https://")) {
      throw new Error(
        `APP_ENV=production 에서는 APP_ORIGIN 이 https 여야 합니다: ${parsed.data.APP_ORIGIN}`,
      );
    }
    // .env.example 의 자리표시자가 그대로 올라가는 것을 막는다.
    const placeholders = (
      [
        ["SESSION_SECRET", parsed.data.SESSION_SECRET],
        ["STORAGE_SECRET", parsed.data.STORAGE_SECRET],
        ["INVITE_TOKEN_PEPPER", parsed.data.INVITE_TOKEN_PEPPER],
      ] as const
    ).filter(([, value]) => value.startsWith("change-me"));
    if (placeholders.length > 0) {
      throw new Error(
        `APP_ENV=production 에서는 기본 시크릿을 쓸 수 없습니다: ${placeholders
          .map(([name]) => name)
          .join(", ")}`,
      );
    }
  }

  // 구글은 client_secret 이 반드시 있어야 토큰 교환이 된다. 반쯤 켜진 상태를 만들지 않는다.
  if (parsed.data.GOOGLE_CLIENT_ID && !parsed.data.GOOGLE_CLIENT_SECRET) {
    throw new Error("GOOGLE_CLIENT_ID 를 주면 GOOGLE_CLIENT_SECRET 도 필요합니다.");
  }
  // 하나도 없으면 주선자가 들어올 방법이 없다. 회원 초대 링크는 그대로 도니 기동은
  // 막지 않고, 대신 기동 로그에서 확인할 수 있게 남긴다.
  if (!parsed.data.KAKAO_CLIENT_ID && !parsed.data.GOOGLE_CLIENT_ID) {
    console.warn(
      "소셜 로그인 키가 없습니다 — 주선자가 로그인할 수 없습니다. " +
        "KAKAO_CLIENT_ID 또는 GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET 를 설정하세요.",
    );
  }

  cached = parsed.data;
  return cached;
}

/**
 * 지금 쓸 수 있는 소셜 로그인 제공자.
 *
 * 로그인 화면과 OAuth 라우트가 같은 판정을 봐야 한다 — 화면에 없는 버튼의 경로를
 * 직접 두드려도 열리지 않게 한다.
 */
export function enabledOAuthProviders(): OAuthProvider[] {
  const e = env();
  const list: OAuthProvider[] = [];
  if (e.KAKAO_CLIENT_ID) list.push("KAKAO");
  if (e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET) list.push("GOOGLE");
  return list;
}

export function isOAuthProviderEnabled(provider: OAuthProvider): boolean {
  return enabledOAuthProviders().includes(provider);
}

/** 쿠키 secure 플래그 등 런타임 동작 판정용. */
export function isProduction(): boolean {
  return env().NODE_ENV === "production";
}


/** 텔레그램 Import 채널이 켜져 있는지. 라우트와 관리자 화면이 함께 이 값을 본다. */
export function isTelegramEnabled(): boolean {
  return env().TELEGRAM_ENABLED;
}

