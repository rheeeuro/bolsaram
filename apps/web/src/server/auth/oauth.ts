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
import {
  buildStorageKey,
  deleteObject,
  isAllowedImageType,
  putObject,
} from "../storage/local";

/** 제공자가 알려준 신원. 여기 적힌 것 말고는 받지 않는다. */
export type OAuthIdentity = {
  provider: OAuthProvider;
  /** 제공자의 고유 식별자. 이메일과 달리 바뀌지 않으므로 계정을 찾는 기준이다. */
  subject: string;
  /** 동의를 받지 못하면 없다(카카오). 계정을 **잇는 힌트**로만 쓴다. */
  email: string | null;
  displayName: string | null;
  /** 제공자 프로필 사진의 주소. 가입할 때 한 번 받아 우리 저장소에 둔다. */
  avatarUrl: string | null;
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
      profile: z
        .object({
          nickname: z.string().nullish(),
          profile_image_url: z.string().nullish(),
          // 카카오가 넣어준 기본 이미지다. 앞글자 자리표시가 더 낫다.
          is_default_image: z.boolean().nullish(),
        })
        .nullish(),
    })
    .nullish(),
});

const googleProfileSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email().nullish(),
  // 확인되지 않은 이메일로 기존 계정에 붙이면 계정 탈취가 된다.
  email_verified: z.boolean().nullish(),
  name: z.string().nullish(),
  picture: z.string().nullish(),
});

const PROVIDERS: Record<OAuthProvider, ProviderConfig> = {
  KAKAO: {
    slug: "kakao",
    authorizeUrl: "https://kauth.kakao.com/oauth/authorize",
    tokenUrl: "https://kauth.kakao.com/oauth/token",
    userInfoUrl: "https://kapi.kakao.com/v2/user/me",
    // 이메일은 선택 동의라 거절될 수 있다. 거절돼도 로그인은 되어야 한다.
    // `profile_image` 는 카카오 개발자 콘솔에서 **동의항목을 켜 두어야** 한다 —
    // 켜지 않은 항목을 요구하면 인가 단계에서 막힌다(KOE205).
    scope: "profile_nickname profile_image account_email",
    credentials: () => ({
      clientId: env().KAKAO_CLIENT_ID!,
      clientSecret: env().KAKAO_CLIENT_SECRET,
    }),
    parseProfile: (raw) => {
      const p = kakaoProfileSchema.parse(raw);
      const profile = p.kakao_account?.profile;
      return {
        subject: String(p.id),
        email: p.kakao_account?.email ?? null,
        displayName: profile?.nickname ?? null,
        avatarUrl: profile?.is_default_image ? null : httpsUrl(profile?.profile_image_url),
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
        avatarUrl: httpsUrl(p.picture),
      };
    },
  },
};

export function providerSlug(provider: OAuthProvider): string {
  return PROVIDERS[provider].slug;
}

/**
 * 제공자가 준 사진 주소 중 https 만 통과시킨다.
 *
 * 이 주소로 우리 서버가 직접 요청을 보내므로(`adoptProviderAvatar`) 제공자가 무엇을
 * 주든 그대로 따라가지 않는다 — 사설망을 가리키는 http 주소를 받아 두지 않는다.
 */
function httpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
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
 *
 * 제공자 프로필 사진은 **연결을 새로 만들 때만** 받아 둔다(`adoptProviderAvatar`).
 * 이름과 같은 규칙이다 — 본인이 정한 사진을 제공자 쪽 변경이 덮지 않는다.
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

  const userId = await withOwnerTx(async (sql) => {
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

  // 사진은 트랜잭션 **밖에서** 받는다 — 제공자 CDN 이 느려도 가입이 붙잡히지 않고,
  // 받지 못해도 로그인은 끝난다(앞글자 자리표시로 시작할 뿐이다).
  if (identity.avatarUrl) await adoptProviderAvatar(userId, identity.avatarUrl);
  return userId;
}

/** 제공자 사진을 받아 둘 때의 상한. 제공자 썸네일이라 업로드 상한(25MB)보다 훨씬 작다. */
const MAX_PROVIDER_AVATAR_BYTES = 4 * 1024 * 1024;
const PROVIDER_AVATAR_TIMEOUT_MS = 5_000;

/**
 * 제공자 프로필 사진을 우리 저장소로 옮긴다. **사진이 없는 계정에만** 붙인다.
 *
 * 제공자 CDN 의 주소를 그대로 화면에 쓰지 않는다 — 우리 사진은 전부 private 스토리지에
 * 있고 단기 signed URL 로만 나간다. 제공자 쪽에서 사진을 바꿔도 따라가지 않으며,
 * 그 뒤로 이 사진을 정하는 것은 본인이다(계정 설정).
 *
 * 실패는 조용히 넘긴다. 사진이 없으면 화면이 앞글자를 그리므로 로그인을 막을 이유가 없다.
 * 주소는 로그에 남기지 않는다.
 */
async function adoptProviderAvatar(userId: string, avatarUrl: string): Promise<void> {
  try {
    const response = await fetch(avatarUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(PROVIDER_AVATAR_TIMEOUT_MS),
    });
    if (!response.ok) return;

    const mimeType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!isAllowedImageType(mimeType)) return;
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_PROVIDER_AVATAR_BYTES) return;

    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength === 0 || body.byteLength > MAX_PROVIDER_AVATAR_BYTES) return;

    const key = buildStorageKey("avatar", userId, mimeType);
    await putObject(key, body);
    // 이미 사진이 있으면 덮지 않는다. 그 경우 방금 올린 파일은 주인이 없으므로 지운다.
    const claimed = await withOwner((sql) =>
      sql.query(`UPDATE users SET avatar_key = $2 WHERE id = $1 AND avatar_key IS NULL`, [
        userId,
        key,
      ]),
    );
    if (claimed.rowCount === 0) await deleteObject(key);
  } catch (error) {
    // 주소도 본문도 남기지 않는다 — 무엇이 막혔는지만 남긴다.
    console.error("제공자 프로필 사진 가져오기 실패", error instanceof Error ? error.name : "unknown");
  }
}

/** 내 계정에 붙어 있는 소셜 계정 하나. 계정 설정의 「로그인 방식」이 읽는다. */
export type LinkedOAuthAccount = {
  provider: OAuthProvider;
  /** 마지막 로그인에서 받은 값. 카카오는 동의를 받지 못하면 비어 있다. */
  email: string | null;
  linkedAt: Date;
  lastLoginAt: Date | null;
};

/**
 * 무엇으로 로그인하고 있는지 보여주기 위한 조회. **본인 것만** 읽는다.
 *
 * `oauth_accounts` 는 인증 전용 테이블이라 런타임 롤에 권한이 없다(0050) — 그래서
 * 이 파일의 다른 경로와 같이 owner 커넥션을 쓰고, `user_id` 를 조건에 박아 범위를
 * 세션 주인 한 사람으로 묶는다. 제공자 식별자(subject)는 화면에 쓸 일이 없어 뽑지 않는다.
 */
export async function listLinkedOAuthAccounts(
  userId: string,
): Promise<LinkedOAuthAccount[]> {
  return withOwner(async (sql) => {
    const result = await sql.query<{
      provider: OAuthProvider;
      email: string | null;
      linked_at: Date;
      last_login_at: Date | null;
    }>(
      `SELECT provider, email, linked_at, last_login_at
         FROM oauth_accounts
        WHERE user_id = $1
        ORDER BY linked_at`,
      [userId],
    );
    return result.rows.map((row) => ({
      provider: row.provider,
      email: row.email,
      linkedAt: row.linked_at,
      lastLoginAt: row.last_login_at,
    }));
  });
}
