/**
 * 초대 링크 진입 = **회원 로그인** (매직 링크).
 * 링크만으로 세션이 생긴다 — 처음이면 계정도 함께 만들어진다.
 *
 * 실패해도 코드를 다시 옮겨 적게 만들지 않는다 — 입장 화면으로 값을 들고 돌려보낸다.
 */
import { isDomainError } from "@bolsaram/domain";
import { AuthShell, AuthFooterLink } from "@/components/ui/auth-shell";
import { previewInvite } from "@/server/auth/invite";
import { safeNextPath } from "@/lib/next-path";
import { ClaimForm } from "./claim-form";

export const dynamic = "force-dynamic";

export default async function ClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { token } = await params;
  const { next } = await searchParams;
  const code = decodeURIComponent(token);

  let preview: Awaited<ReturnType<typeof previewInvite>> | null = null;
  let error: string | null = null;
  try {
    preview = await previewInvite(code);
  } catch (e) {
    error = isDomainError(e) ? e.message : "초대 링크를 확인할 수 없습니다.";
  }

  if (error) {
    return (
      <AuthShell
        title="들어갈 수 없어요"
        description={error}
        footer={
          <>
            <AuthFooterLink href={`/enter?code=${encodeURIComponent(code)}`} label="다시 시도하기">
              코드를 잘못 옮겨 적었을 수 있습니다.
            </AuthFooterLink>
            <p className="text-[12.5px] leading-relaxed text-[var(--color-ink-500)]">
              링크와 입장코드는 한 번만 쓸 수 있고 72시간 뒤 만료됩니다. 이미 쓴 것이라면
              주선자에게 새로 요청해 주세요.
            </p>
          </>
        }
      />
    );
  }

  return (
    <AuthShell
      title="볼사람에 오신 걸 환영합니다"
      description={
        preview?.alreadyClaimedProfile
          ? "주선자가 보낸 링크로 바로 들어갑니다."
          : `주선자가 등록한 #${preview?.publicCode ?? ""} 프로필로 시작합니다. 아이디와 비밀번호는 만들지 않습니다.`
      }
    >
      <ClaimForm
        token={code}
        alreadyLinked={preview?.alreadyClaimedProfile ?? false}
        next={safeNextPath(next)}
      />
    </AuthShell>
  );
}
