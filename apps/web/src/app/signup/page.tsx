/**
 * 주선자 가입.
 *
 * 회원은 이 화면을 쓰지 않는다 — 계정을 만드는 쪽은 주선자뿐이다.
 */
import { redirect } from "next/navigation";
import { AuthShell, AuthFooterLink } from "@/components/ui/auth-shell";
import { readSession } from "@/server/auth/session";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const user = await readSession();
  if (user) redirect(user.role === "ADMIN" ? "/home" : "/discover");

  return (
    <AuthShell
      title="주선자로 시작하기"
      description="회원을 등록해 두 사람을 연결합니다. 모임은 가입 후에 만들거나 참여합니다."
      footer={
        <>
          <AuthFooterLink href="/login" label="로그인">
            이미 주선자 계정이 있으신가요?
          </AuthFooterLink>
          <AuthFooterLink href="/enter" label="입장코드로 들어가기">
            초대받은 회원은 계정을 만들지 않습니다.
          </AuthFooterLink>
        </>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
