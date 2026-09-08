/**
 * 회원 입장 — 입장코드 하나만 묻는다.
 *
 * 회원에게는 아이디도 비밀번호도 없다. 초대 링크를 열면 이 화면을 거치지 않고 바로
 * `/claim` 으로 들어가므로, 여기 오는 사람은 **코드만 받았거나 세션이 만료된 회원**이다.
 * 주선자 로그인과 한 화면에 섞지 않는다 — 두 청중이 서로의 폼을 읽을 필요가 없다.
 */
import { redirect } from "next/navigation";
import { AuthShell, AuthFooterLink } from "@/components/ui/auth-shell";
import { readSession } from "@/server/auth/session";
import { safeNextPath } from "@/lib/next-path";
import { EnterForm } from "./enter-form";

export const dynamic = "force-dynamic";

export default async function EnterPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; next?: string }>;
}) {
  const user = await readSession();
  if (user) redirect(user.role === "ADMIN" ? "/admin" : "/discover");
  const { code, next } = await searchParams;

  return (
    <AuthShell
      title="입장코드로 들어가기"
      description="주선자가 보낸 초대 링크를 열면 코드 없이 바로 들어갑니다. 코드만 받으셨다면 아래에 넣어 주세요."
      footer={
        <>
          <AuthFooterLink href="/login" label="주선자 로그인">
            프로필을 등록하는 분이신가요?
          </AuthFooterLink>
          <p className="text-[12.5px] leading-relaxed text-[var(--color-ink-500)]">
            코드는 한 번만 쓸 수 있고 72시간 뒤 만료됩니다. 안 들어가면 주선자에게 다시
            요청하세요.
          </p>
        </>
      }
    >
      <EnterForm initialCode={code ?? ""} next={safeNextPath(next)} />
    </AuthShell>
  );
}
