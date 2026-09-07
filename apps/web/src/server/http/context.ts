/** 라우트에서 반복되는 "세션 읽고 RLS 컨텍스트 만들기" 를 한 곳에 모은다. */
import "server-only";
import { withRls, type Sql } from "@bolsaram/db";
import {
  requireAdmin,
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

export async function asMember<T>(
  fn: (sql: Sql, viewer: Viewer & { profileId: string }) => Promise<T>,
): Promise<T> {
  const viewer = await requireMemberProfile();
  return withRls(rlsContextOf(viewer), (sql) => fn(sql, viewer));
}
