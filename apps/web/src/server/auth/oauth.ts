/**
 * 주선자 로그인 — 카카오·구글 OAuth 2.0 (authorization code + PKCE).
 *
 * 비밀번호를 우리가 받지 않는다. **처음 들어온 제공자 계정이 곧 가입**이고 그 뒤로는
 * 같은 버튼이 로그인이다 — 그래서 로그인과 가입 경로가 하나다.
 *
 * 멤버는 여기를 지나지 않는다. 멤버 로그인은 주선자가 보내는 초대 링크뿐이다
 * (`server/auth/invite.ts`).
 *
 * owner 커넥션을 쓰는 이유는 세션·초대 검증과 같다 — 인증 이전이라 RLS 컨텍스트가 없다.
 * 계정이 만들어진 뒤 무엇을 볼 수 있는지는 전부 RLS 가 정한다. 가입 자체는 아무 데이터에도
 * 접근 권한을 주지 않는다(속한 모임이 없다).
 */
import "server-only";
import { withOwner, withOwnerTx } from "@bolsaram/db";
import { DomainError } from "@bolsaram/domain";
import {
  OAUTH_PROVIDERS,
  OAUTH_PROVIDER_LABELS,
  type OAuthProvider,
} from "@bolsaram/schemas";
import { z } from "zod";
import { env, isOAuthProviderEnabled } from "../env";
import { hmac, randomToken, safeEqual, sha256b64url } from "../crypto";

/** 제공자가 알려준 신원. 이 세 가지 말고는 받지 않는다. */
export type OAuthIdentity = {
  provider: OAuthProvider;
  /** 제공자의 고유 식별자. 이메일과 달리 바뀌지 않으므로 계정을 찾는 기준이다. */
  subject: string;
  /** 동의를 받지 못하면 없다(카카오). 계정을 **잇는 힌트**로만 쓴다. */
  email: string | null;
  displayName: string | null;
};

type ProviderConfig = {
  slug: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string;
  credentials: () => { clientId: string; clientSecret: string | undefined };
  /** 외부 payload 는 Zod 로 검증한 뒤에만 쓴다 — AI raw 출력과 같은 규칙이다. */
  parseProfile: (raw: unknown) => Omit<OAuthIdentity, "provider">;
};

const kakaoProfileSchema = z.object({
  id: z.union([z.number(), z.string()]),
  kakao_account: z
    .object({
      email: z.string().email().nullish(),
      profile: z.object({ nickname: z.string().nullish() }).nullish(),
    })
    .nullish(),
});

const googleProfileSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email().nullish(),
  // 확인되지 않은 이메일로 기존 계정에 붙이면 계정 탈취가 된다.
  email_verified: z.boolean().nullish(),
  name: z.string().nullish(),
});

const PROVIDERS: Record<OAuthProvider, ProviderConfig> = {
  KAKAO: {
    slug: "kakao",
    authorizeUrl: "https://kauth.kakao.com/oauth/authorize",
    tokenUrl: "https://kauth.kakao.com/oauth/token",
    userInfoUrl: "https://kapi.kakao.com/v2/user/me",
    // 이메일은 선택 동의라 거절될 수 있다. 거절돼도 로그인은 되어야 한다.
    scope: "profile_nickname account_email",
    credentials: () => ({
      clientId: env().KAKAO_CLIENT_ID!,
      clientSecret: env().KAKAO_CLIENT_SECRET,
    }),
    parseProfile: (raw) => {
      const p = kakaoProfileSchema.parse(raw);
      return {
        subject: String(p.id),
        email: p.kakao_account?.email ?? null,
        displayName: p.kakao_account?.profile?.nickname ?? null,
      };
    },
  },
  GOOGLE: {
    slug: "google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
    credentials: () => ({
      clientId: env().GOOGLE_CLIENT_ID!,
      clientSecret: env().GOOGLE_CLIENT_SECRET,
    }),
    parseProfile: (raw) => {
      const p = googleProfileSchema.parse(raw);
      return {
        subject: p.sub,
        email: p.email_verified === false ? null : (p.email ?? null),
        displayName: p.name ?? null,
      };
    },
  },
};

export function providerSlug(provider: OAuthProvider): string {
  return PROVIDERS[provider].slug;
}

/** 제공자 콘솔에 등록해야 하는 Redirect URI. 화면 안내와 실제 요청이 같은 값을 쓴다. */
export function oauthRedirectUri(provider: OAuthProvider): string {
  return `${env().APP_ORIGIN}/api/auth/oauth/${PROVIDERS[provider].slug}/callback`;
}

// ── 왕복 상태 ────────────────────────────────────────────────
//
// state 와 PKCE verifier 를 **쿠키에** 둔다. DB 에 한 줄 남기는 대신 쿠키를 쓰는 이유는
// 로그인 전이라 지울 주체가 없기 때문이다 — 쿠키는 브라우저가 알아서 만료시킨다.
// 서명해서 우리가 발급한 값인지 확인하고, 유효시간을 짧게 둔다.
//
// 쿠키를 읽고 쓰는 것은 라우트가 한다. 이 모듈은 `next/headers` 를 모른다 — 요청
// 컨텍스트 없이도 판정을 시험할 수 있어야 한다(tests/oauth-login.test.ts).

export const OAUTH_COOKIE = "bolsaram_oauth";
export const OAUTH_STATE_TTL_MS = 10 * 60_000;

const stateSchema = z.object({
  provider: z.enum(OAUTH_PROVIDERS),
  state: z.string().min(10),
  verifier: z.string().min(10),
  next: z.string().nullable(),
  issuedAt: z.number().int(),
});
type OAuthState = z.infer<typeof stateSchema>;

function sealState(value: OAuthState): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${hmac(env().SESSION_SECRET, payload)}`;
}

function openState(raw: string): OAuthState | null {
  const dot = raw.indexOf(".");
  if (dot < 0) return null;
  const payload = raw.slice(0, dot);
  if (!safeEqual(hmac(env().SESSION_SECRET, payload), raw.slice(dot + 1))) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = stateSchema.safeParse(decoded);
  if (!parsed.success) return null;
  if (Date.now() - parsed.data.issuedAt > OAUTH_STATE_TTL_MS) return null;
  return parsed.data;
}

/**
 * 로그인 시작 — 제공자 인가 화면 주소와, 되돌아왔을 때 맞춰 볼 쿠키 값을 만든다.
 */
export function startOAuth(
  provider: OAuthProvider,
  next: string | null,
): { authorizeUrl: string; cookieValue: string } {
  assertProviderEnabled(provider);
  const config = PROVIDERS[provider];
  const value: OAuthState = {
    provider,
    state: randomToken(24),
    verifier: randomToken(32),
    next,
    issuedAt: Date.now(),
  };

  const url = new URL(config.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.credentials().clientId);
  url.searchParams.set("redirect_uri", oauthRedirectUri(provider));
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", value.state);
  url.searchParams.set("code_challenge", sha256b64url(value.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return { authorizeUrl: url.toString(), cookieValue: sealState(value) };
}

/**
 * 콜백 — 되돌아온 code 를 신원으로 바꾼다.
 *
 * 라우트는 결과와 상관없이 쿠키를 지운다. 한 번 쓴 state 가 남아 있으면 재생의 여지가 된다.
 */
export async function completeOAuth(input: {
  provider: OAuthProvider;
  code: string;
  state: string;
  cookieValue: string | null;
}): Promise<{ identity: OAuthIdentity; next: string | null }> {
  assertProviderEnabled(input.provider);
  const sealed = input.cookieValue ? openState(input.cookieValue) : null;
  // 제공자가 준 state 와 우리가 심은 state 가 같아야 한다. 만료·위조·제공자 뒤바뀜을
  // 모두 같은 문구로 돌려보낸다 — 어느 쪽이 틀렸는지 알려줄 이유가 없다.
  if (
    !sealed ||
    sealed.provider !== input.provider ||
    !safeEqual(sealed.state, input.state)
  ) {
    throw new DomainError("FORBIDDEN", "로그인 요청이 만료되었습니다. 다시 시도해 주세요.");
  }

  const accessToken = await exchangeCode(input.provider, input.code, sealed.verifier);
  const identity = await fetchIdentity(input.provider, accessToken);
  return { identity, next: sealed.next };
}

function assertProviderEnabled(provider: OAuthProvider): void {
  if (!isOAuthProviderEnabled(provider)) {
    throw new DomainError(
      "FORBIDDEN",
      `${OAUTH_PROVIDER_LABELS[provider]} 로그인이 설정되지 않았습니다.`,
    );
  }
}

async function exchangeCode(
  provider: OAuthProvider,
  code: string,
  verifier: string,
): Promise<string> {
  const config = PROVIDERS[provider];
  const { clientId, clientSecret } = config.credentials();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: oauthRedirectUri(provider),
    code,
    code_verifier: verifier,
  });
  if (clientSecret) body.set("client_secret", clientSecret);

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!response.ok) {
    // 본문에는 우리 client_secret 이 되비칠 수 있어 상태 코드만 남긴다.
    console.error(`${provider} 토큰 교환 실패`, response.status);
    throw new DomainError("FORBIDDEN", "로그인을 끝내지 못했습니다. 다시 시도해 주세요.");
  }
  const parsed = z
    .object({ access_token: z.string().min(1) })
    .safeParse((await response.json()) as unknown);
  if (!parsed.success) {
    throw new DomainError("FORBIDDEN", "로그인을 끝내지 못했습니다. 다시 시도해 주세요.");
  }
  return parsed.data.access_token;
}

async function fetchIdentity(
  provider: OAuthProvider,
  accessToken: string,
): Promise<OAuthIdentity> {
  const config = PROVIDERS[provider];
  const response = await fetch(config.userInfoUrl, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    console.error(`${provider} 사용자 정보 조회 실패`, response.status);
    throw new DomainError("FORBIDDEN", "로그인을 끝내지 못했습니다. 다시 시도해 주세요.");
  }
  return { provider, ...config.parseProfile((await response.json()) as unknown) };
}

// ── 계정 ─────────────────────────────────────────────────────

/**
 * 제공자 신원을 주선자 계정으로 바꾼다. 없으면 만든다.
 *
 * 찾는 순서가 곧 규칙이다.
 *   1. `oauth_accounts` 의 (provider, subject) — 이미 연결된 계정
 *   2. **확인된** 이메일이 같은 주선자 — 카카오로 만든 계정에 구글로 들어온 경우
 *   3. 없으면 새 주선자 계정
 *
 * 2번은 이메일을 믿는 단계라 조건을 좁게 둔다. 구글은 `email_verified` 가 거짓이면
 * 이메일을 버리고 오고, 멤버 계정에는 절대 붙이지 않는다 — 멤버는 초대 링크로만 들어온다.
 */
export async function loginWithOAuth(identity: OAuthIdentity): Promise<string> {
  const linked = await withOwner(async (sql) => {
    const found = await sql.query<{ user_id: string }>(
      `UPDATE oauth_accounts
          SET last_login_at = now(), email = $3
        WHERE provider = $1 AND subject = $2
        RETURNING user_id`,
      [identity.provider, identity.subject, identity.email],
    );
    return found.rows[0]?.user_id ?? null;
  });
  if (linked) return linked;

  return withOwnerTx(async (sql) => {
    let userId: string | null = null;

    if (identity.email) {
      const existing = await sql.query<{ id: string; role: string }>(
        `SELECT id, role FROM users WHERE email = $1`,
        [identity.email],
      );
      const row = existing.rows[0];
      if (row) {
        if (row.role !== "ADMIN") {
          throw new DomainError(
            "FORBIDDEN",
            "이 이메일은 멤버 계정입니다. 멤버는 주선자가 보낸 초대 링크로 들어옵니다.",
          );
        }
        userId = row.id;
      }
    }

    if (!userId) {
      const created = await sql.query<{ id: string }>(
        `INSERT INTO users (role, email, display_name)
         VALUES ('ADMIN', $1, $2) RETURNING id`,
        [identity.email, identity.displayName?.trim() || "주선자"],
      );
      userId = created.rows[0]!.id;
    } else if (identity.displayName) {
      // 이름이 비어 있던 계정만 채운다. 주선자가 화면에서 고친 이름을 덮지 않는다.
      await sql.query(
        `UPDATE users SET display_name = $2 WHERE id = $1 AND display_name IS NULL`,
        [userId, identity.displayName.trim()],
      );
    }

    await sql.query(
      `INSERT INTO oauth_accounts (provider, subject, user_id, email, last_login_at)
       VALUES ($1, $2, $3, $4, now())`,
      [identity.provider, identity.subject, userId, identity.email],
    );
    return userId;
  });
}
