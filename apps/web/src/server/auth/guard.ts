/**
 * 서버 권한 검증. RLS 와 별개로 애플리케이션 레이어에서도 한 번 더 막는다
 * (부트스트랩 §4 「server authorization, admin route guard」).
 */
import "server-only";
import { redirect } from "next/navigation";
import { DomainError } from "@bolsaram/domain";
import type { RlsContext } from "@bolsaram/db";
import { readSession, type SessionUser } from "./session";

export type Viewer = SessionUser;

/** 로그인 필수. 없으면 DomainError — API 라우트가 401 로 번역한다. */
export async function requireUser(): Promise<Viewer> {
  const user = await readSession();
  if (!user) throw new DomainError("FORBIDDEN", "로그인이 필요합니다.");
  return user;
}

export async function requireAdmin(): Promise<Viewer> {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    throw new DomainError("FORBIDDEN", "관리자만 접근할 수 있습니다.");
  }
  return user;
}

/**
 * 모임에 속한 주선자만 통과. 데이터를 만들거나 고치는 관리자 동작에 쓴다.
 *
 * 주선자 가입은 자유롭게 열려 있으므로 **모임이 없는 주선자 계정이 존재한다.**
 * 그 계정은 RLS 에서도 아무것도 보지 못하지만, 애플리케이션 레이어에서 먼저 막아
 * 빈 화면 대신 이유를 알려준다(권한 검사는 두 곳에 중복으로 둔다).
 */
export async function requireAdminGroup(): Promise<Viewer & { groupId: string }> {
  const user = await requireAdmin();
  if (!user.groupId) {
    throw new DomainError(
      "FORBIDDEN",
      "아직 모임에 속해 있지 않습니다. 모임을 만들거나 초대를 받아 주세요.",
    );
  }
  return { ...user, groupId: user.groupId };
}

/**
 * Claim 을 마친 회원만 통과. 신청/관심 등 프로필이 있어야 하는 동작에 쓴다.
 * 관리자는 자기 프로필이 없을 수 있으므로 이 가드를 쓰지 않는다.
 */
export async function requireMemberProfile(): Promise<Viewer & { profileId: string }> {
  const user = await requireUser();
  if (!user.profileId) {
    throw new DomainError("FORBIDDEN", "먼저 초대 링크로 본인 프로필을 연결해 주세요.");
  }
  return { ...user, profileId: user.profileId };
}

/** 페이지(서버 컴포넌트)용. 실패 시 예외 대신 리다이렉트한다. */
export async function requireUserPage(next?: string): Promise<Viewer> {
  const user = await readSession();
  if (!user) redirect(loginPath(next));
  return user;
}

export async function requireAdminPage(next?: string): Promise<Viewer> {
  const user = await readSession();
  if (!user) redirect(loginPath(next));
  if (user.role !== "ADMIN") redirect("/discover");
  return user;
}

function loginPath(next?: string): string {
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}

/** RLS GUC 에 넣을 컨텍스트로 변환한다. */
export function rlsContextOf(user: Viewer | null): RlsContext {
  return user ? { userId: user.userId, role: user.role } : { userId: null, role: null };
}
