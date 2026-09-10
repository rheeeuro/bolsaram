/**
 * 서버 권한 검증. RLS 와 별개로 애플리케이션 레이어에서도 한 번 더 막는다
 * (부트스트랩 §4 「server authorization, admin route guard」).
 * 역할 이름은 DB 의 `ADMIN` 을 그대로 쓰고, 화면에서는 「주선자」로 부른다.
 */
import "server-only";
import { redirect } from "next/navigation";
import { DomainError } from "@bolsaram/domain";
import type { RlsContext } from "@bolsaram/db";
import { assertGroupAdmin } from "./group-invite";
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
    throw new DomainError("FORBIDDEN", "주선자만 접근할 수 있습니다.");
  }
  return user;
}

/**
 * 모임 하나를 지정해 다루는 주선자만 통과. 모임 설정·초대 코드·나가기에 쓴다.
 *
 * 이 경로들은 owner 커넥션으로 도는 인증 레이어라 RLS 정책이 걸리지 않는다 —
 * 소속 확인이 전적으로 여기 달려 있다(`assertGroupAdmin`).
 */
export async function requireGroupAdmin(groupId: string): Promise<Viewer> {
  const user = await requireAdmin();
  await assertGroupAdmin(user.userId, groupId);
  return user;
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
  // 회원 화면이다 — 회원에게는 이메일·비밀번호가 없으므로 입장코드 화면으로 보낸다.
  // 주선자가 회원 화면(`/me`)에서 만료됐다면 그 화면의 링크로 로그인으로 넘어간다.
  if (!user) redirect(enterPath(next));
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

function enterPath(next?: string): string {
  return next ? `/enter?next=${encodeURIComponent(next)}` : "/enter";
}

/** RLS GUC 에 넣을 컨텍스트로 변환한다. */
export function rlsContextOf(user: Viewer | null): RlsContext {
  return user
    ? {
        userId: user.userId,
        role: user.role,
        actingProfileId: user.actingProfileId,
      }
    : { userId: null, role: null };
}
