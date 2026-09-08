/**
 * 초대 링크 진입 = **회원 로그인** (매직 링크).
 * 링크만으로 세션이 생긴다 — 처음이면 계정도 함께 만들어진다.
 */
import Link from "next/link";
import { isDomainError } from "@bolsaram/domain";
import { BRAND } from "@bolsaram/ui-tokens";
import { previewInvite } from "@/server/auth/invite";
import { ClaimForm } from "./claim-form";

export const dynamic = "force-dynamic";

export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let preview: Awaited<ReturnType<typeof previewInvite>> | null = null;
  let error: string | null = null;
  try {
    preview = await previewInvite(decodeURIComponent(token));
  } catch (e) {
    error = isDomainError(e) ? e.message : "초대 링크를 확인할 수 없습니다.";
  }

  return (
    <main className="member-surface flex min-h-dvh flex-col bg-[var(--color-ivory-50)]">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-7 py-12">
        <p className="kicker mb-3">{BRAND.kicker}</p>
        <h1 className="display text-[28px] leading-tight text-[var(--color-ink-900)]">
          {error ? "초대를 확인할 수 없어요" : "볼사람에 오신 걸 환영합니다"}
        </h1>

        {error ? (
          <>
            <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-ink-700)]">
              {error}
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-ink-600)]">
              입장코드를 잘못 옮겨 적었을 수 있습니다. 다시 넣어 보시고, 그래도 안 되면
              주선자에게 새 링크를 요청해 주세요.
            </p>
            <Link
              href="/login"
              className="mt-8 text-[13px] text-[var(--color-rose-600)] underline"
            >
              입장코드 다시 넣기
            </Link>
          </>
        ) : (
          <>
            <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-ink-700)]">
              {preview?.alreadyClaimedProfile
                ? `주선자가 보낸 링크로 바로 들어갑니다.`
                : `주선자가 등록한 #${preview?.publicCode ?? ""} 프로필로 시작합니다.`}
            </p>
            <div className="mt-8">
              <ClaimForm
                token={token}
                alreadyLinked={preview?.alreadyClaimedProfile ?? false}
              />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
