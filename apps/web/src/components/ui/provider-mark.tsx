import type { OAuthProvider } from "@bolsaram/schemas";

/**
 * 카카오·구글 로고. 로그인 버튼과 계정 설정의 「로그인 방식」이 같은 마크를 쓴다.
 *
 * 브랜드 마크라 색을 우리가 정하지 않는다 — 카카오는 버튼 색 위에 올라가므로
 * `currentColor` 를 따르고, 구글은 지정된 네 색을 그대로 쓴다.
 */
export function ProviderMark({
  provider,
  size = 18,
}: {
  provider: OAuthProvider;
  size?: number;
}) {
  if (provider === "KAKAO") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
        <path
          fill="currentColor"
          d="M12 3C6.9 3 2.8 6.2 2.8 10.2c0 2.5 1.7 4.7 4.2 6l-1 3.6c-.1.3.3.6.6.4l4.3-2.8c.4 0 .7.1 1.1.1 5.1 0 9.2-3.2 9.2-7.3S17.1 3 12 3z"
        />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden focusable="false">
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
