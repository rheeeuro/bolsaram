import type { OAuthProvider } from "@bolsaram/schemas";

/**
 * 소셜 로그인 버튼.
 *
 * 폼이 아니라 링크다 — 누르면 우리 서버가 제공자로 302 를 보낸다. 그래서 클라이언트
 * 컴포넌트가 아니고, 자바스크립트가 끊겨도 동작한다.
 *
 * 카카오·구글은 각자 버튼 가이드가 있어서 브랜드 팔레트를 그대로 쓴다. 이 두 버튼만
 * 예외이고, 화면의 나머지는 볼사람 톤을 유지한다.
 */
const STYLES: Record<OAuthProvider, { label: string; className: string }> = {
  KAKAO: {
    label: "카카오로 계속하기",
    className: "bg-[#FEE500] text-[#191600] hover:brightness-95",
  },
  GOOGLE: {
    label: "구글로 계속하기",
    className:
      "border border-[var(--surface-border)] bg-white text-[var(--color-ink-800)] hover:bg-[var(--color-ivory-100)]",
  },
};

export function ProviderButton({
  provider,
  slug,
  next,
}: {
  provider: OAuthProvider;
  slug: string;
  next: string | null;
}) {
  const style = STYLES[provider];
  const href = `/api/auth/oauth/${slug}/start${
    next ? `?next=${encodeURIComponent(next)}` : ""
  }`;

  return (
    <a
      href={href}
      className={`flex h-13 items-center justify-center gap-2.5 rounded-xl py-3.5 text-[15px] font-medium transition-all ${style.className}`}
    >
      {provider === "KAKAO" ? <KakaoMark /> : <GoogleMark />}
      {style.label}
    </a>
  );
}

function KakaoMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M12 3C6.9 3 2.8 6.2 2.8 10.2c0 2.5 1.7 4.7 4.2 6l-1 3.6c-.1.3.3.6.6.4l4.3-2.8c.4 0 .7.1 1.1.1 5.1 0 9.2-3.2 9.2-7.3S17.1 3 12 3z"
      />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l6.9 5.3c4.1-3.8 6.6-9.4 6.6-15.6z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.3c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C7.9 41.1 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.5 28.5c-.5-1.4-.7-2.9-.7-4.5s.3-3.1.7-4.5l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 10l7.1-5.5z"
      />
      <path
        fill="#EA4335"
        d="M24 10.4c4.1 0 6.9 1.8 8.5 3.3l6.1-6C34.9 4.3 29.9 2 24 2 15.4 2 7.9 6.9 4.4 14l7.1 5.5c1.8-5.3 6.7-9.1 12.5-9.1z"
      />
    </svg>
  );
}
