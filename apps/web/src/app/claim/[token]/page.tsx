/**
 * 초대 링크 진입 (설계문서 §4 가입/Claim).
 * 로그인 전이면 초대 대상 프로필만 보여주고, 로그인 후 본인 확인을 거쳐 연결한다.
 */
import Link from "next/link";
import { isDomainError } from "@bolsaram/domain";
import { BRAND } from "@bolsaram/ui-tokens";
import { previewInvite } from "@/server/auth/invite";
import { readSession } from "@/server/auth/session";
import { ClaimForm } from "./claim-form";

export const dynamic = "force-dynamic";

export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await readSession();

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
            <Link href="/" className="mt-8 text-[13px] text-[var(--color-rose-600)] underline">
              처음으로
            </Link>
          </>
        ) : preview?.alreadyClaimedProfile ? (
          <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-ink-700)]">
            이 프로필은 이미 다른 계정에 연결되어 있습니다. 주선자에게 문의해 주세요.
          </p>
        ) : (
          <>
            <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-ink-700)]">
              주선자가 등록한 <strong>#{preview?.publicCode}</strong> 프로필을 회원님 계정에
              연결합니다.
            </p>
            <div className="mt-8">
              <ClaimForm token={token} loggedIn={user != null} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
