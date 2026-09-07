/** 라우트에서 반복되는 "세션 읽고 RLS 컨텍스트 만들기" 를 한 곳에 모은다. */
import "server-only";
import { withRls, type Sql } from "@bolsaram/db";
import {
  requireAdmin,
  requireAdminGroup,
  requireMemberProfile,
  requireUser,
  rlsContextOf,
  type Viewer,
} from "../auth/guard";

export async function asUser<T>(fn: (sql: Sql, viewer: Viewer) => Promise<T>): Promise<T> {
  const viewer = await requireUser();
  return withRls(rlsContextOf(viewer), (sql) => fn(sql, viewer));
}

export async function asAdmin<T>(fn: (sql: Sql, viewer: Viewer) => Promise<T>): Promise<T> {
  const viewer = await requireAdmin();
  return withRls(rlsContextOf(viewer), (sql) => fn(sql, viewer));
}

/**
 * 모임에 속한 주선자로 실행한다. 데이터를 만들거나 고치는 경로는 이걸 쓴다 —
 * `asAdmin` 은 모임이 없어도 통과하므로 조회 전용에만 쓴다.
 */
export async function asGroupAdmin<T>(
  fn: (sql: Sql, viewer: Viewer & { groupId: string }) => Promise<T>,
): Promise<T> {
  const viewer = await requireAdminGroup();
  return withRls(rlsContextOf(viewer), (sql) => fn(sql, viewer));
}

export async function asMember<T>(
  fn: (sql: Sql, viewer: Viewer & { profileId: string }) => Promise<T>,
): Promise<T> {
  const viewer = await requireMemberProfile();
  return withRls(rlsContextOf(viewer), (sql) => fn(sql, viewer));
}
