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
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),

  DEV_EXPOSE_OTP: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
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
  // OTP 노출은 개발 환경에서만 허용한다.
  if (parsed.data.NODE_ENV === "production" && parsed.data.DEV_EXPOSE_OTP) {
    throw new Error("운영 환경에서는 DEV_EXPOSE_OTP 를 켤 수 없습니다.");
  }
  cached = parsed.data;
  return cached;
}

export function isProduction(): boolean {
  return env().NODE_ENV === "production";
}
