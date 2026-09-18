/**
 * 주선자 로그인 — 카카오 · 구글.
 *
 * 가입 화면이 따로 없다. 처음 들어온 소셜 계정이면 그 자리에서 주선자 계정이 만들어지고,
 * 그다음부터는 같은 버튼이 로그인이다. 회원 입장은 `/enter`(입장코드)로 분리돼 있다.
 */
import { redirect } from "next/navigation";
import { OAUTH_PROVIDER_LABELS } from "@bolsaram/schemas";
import { AuthShell, AuthFooterLink } from "@/components/ui/auth-shell";
import { FormError } from "@/components/ui/field";
import { readSession } from "@/server/auth/session";
import { enabledOAuthProviders } from "@/server/env";
import { providerSlug } from "@/server/auth/oauth";
import { safeNextPath } from "@/lib/next-path";
import { ProviderButton } from "./provider-button";

export const dynamic = "force-dynamic";

/** 콜백이 실패를 쿼리로만 되돌려준다 — 문구는 화면이 정한다. */
const ERRORS: Record<string, string> = {
  start: "로그인을 시작하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
  canceled: "로그인을 취소했습니다.",
  failed: "로그인을 끝내지 못했습니다. 다시 시도해 주세요.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const user = await readSession();
  if (user) redirect(user.role === "ADMIN" ? "/home" : "/discover");
  const { next, error } = await searchParams;
  const providers = enabledOAuthProviders();

  return (
    <AuthShell
      title="주선자 로그인"
      description="회원을 등록하고 연결하는 분을 위한 화면입니다. 처음이시면 로그인과 동시에 계정이 만들어집니다."
      footer={
        <>
          <AuthFooterLink href="/enter" label="입장코드로 들어가기">
            초대받은 회원이신가요?
          </AuthFooterLink>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {providers.map((provider) => (
          <ProviderButton
            key={provider}
            provider={provider}
            slug={providerSlug(provider)}
            next={safeNextPath(next)}
          />
        ))}

        {/* 키가 없으면 버튼이 하나도 없다. 빈 화면 대신 이유를 말해준다. */}
        {providers.length === 0 ? (
          <p className="rounded-xl bg-[var(--color-ivory-100)] px-4 py-3.5 text-[13px] leading-relaxed text-[var(--color-ink-700)]">
            소셜 로그인이 아직 설정되지 않았습니다. 운영자에게 문의해 주세요.
          </p>
        ) : null}

        <FormError>{error ? (ERRORS[error] ?? ERRORS.failed) : null}</FormError>

        <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-ink-600)]">
          {providers.map((p) => OAUTH_PROVIDER_LABELS[p]).join(" · ")} 계정으로 본인 확인만
          합니다. 비밀번호는 볼사람에 저장되지 않습니다.
        </p>
      </div>
    </AuthShell>
  );
}
