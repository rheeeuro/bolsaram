/**
 * 주선자 로그인 — 이메일 + 비밀번호.
 *
 * 계정을 가진 쪽은 주선자뿐이다. 회원 입장은 `/enter`(입장코드)로 분리했다.
 */
import { redirect } from "next/navigation";
import { AuthShell, AuthFooterLink } from "@/components/ui/auth-shell";
import { readSession } from "@/server/auth/session";
import { safeNextPath } from "@/lib/next-path";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await readSession();
  if (user) redirect(user.role === "ADMIN" ? "/home" : "/discover");
  const { next } = await searchParams;

  return (
    <AuthShell
      title="주선자 로그인"
      description="회원을 등록하고 연결하는 분을 위한 화면입니다."
      footer={
        <>
          <AuthFooterLink href="/enter" label="입장코드로 들어가기">
            초대받은 회원이신가요?
          </AuthFooterLink>
          <AuthFooterLink href="/signup" label="주선자로 시작하기">
            아직 주선자 계정이 없으신가요?
          </AuthFooterLink>
        </>
      }
    >
      <LoginForm next={safeNextPath(next)} />
    </AuthShell>
  );
}
