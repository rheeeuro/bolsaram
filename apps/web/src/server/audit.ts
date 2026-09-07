/**
 * 감사 로그 (설계문서 §12).
 * 사진 URL·프로필 원문 등 민감한 값은 metadata 에 넣지 않는다 — id 와 상태만 남긴다.
 */
import "server-only";
import type { Sql } from "@bolsaram/db";

export type AuditEntry = {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

/** 이미 열려 있는 RLS 트랜잭션 안에서 호출한다. 같은 트랜잭션에 기록돼야 한다. */
export async function writeAudit(sql: Sql, entry: AuditEntry): Promise<void> {
  await sql.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      entry.actorUserId,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}
