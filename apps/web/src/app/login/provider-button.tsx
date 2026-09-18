import type { OAuthProvider } from "@bolsaram/schemas";
import { ProviderMark } from "@/components/ui/provider-mark";

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
      <ProviderMark provider={provider} />
      {style.label}
    </a>
  );
}
