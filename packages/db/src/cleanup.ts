/**
 * 만료 데이터 정리 로직 (설계문서 §12 「Import 원본 보관/삭제 정책」, rate limit).
 * 실행기는 cli/cleanup.ts — 여기는 테스트할 수 있도록 순수 로직만 둔다.
 * 모든 단계는 여러 번 돌려도 안전하다(idempotent).
 *
 * 파일 삭제 원칙: **profile_images 가 참조하는 storage_key 는 절대 지우지 않는다.**
 * commit 된 Import 는 에셋 파일을 복사하지 않고 같은 키를 프로필 사진으로 연결하므로,
 * 세션만 보고 지우면 게시된 프로필 사진이 깨진다.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { TELEGRAM_SESSION_TTL_HOURS } from "@bolsaram/domain";
import type { Sql } from "./client.js";

/** 보존 기간(일). 운영 정책이 정해지면 이 값을 조정한다. */
export const RETENTION = {
  /** 만료·폐기된 세션 행 */
  sessions: 30,
  /** 소비·만료된 로그인 코드 */
  loginCodes: 7,
  /** 사용·만료된 초대 */
  invites: 90,
  /** 등록되지 않은 채 방치된 Import 세션 — 원본 사진까지 지운다 */
  abandonedImports: 30,
  /** 등록이 끝난 Import 세션의 모델 원문(raw_model_output) */
  rawModelOutput: 14,
  /** 감사 로그 */
  auditLogs: 365,
  /**
   * 처리한 webhook 이벤트. 중복 판정에 쓰이므로 텔레그램이 재전송을 포기하는
   * 기간(최대 하루)보다 넉넉히 길게 둔다.
   */
  telegramWebhookEvents: 7,
  /** 소비·만료된 봇 연결 코드 */
  telegramLinkCodes: 7,
} as const;

export type Step = { label: string; run: (sql: Sql) => Promise<number> };

export const STEPS: Step[] = [
  {
    label: "만료 세션",
    run: async (sql) => {
      const r = await sql.query(
        `DELETE FROM sessions
          WHERE (expires_at < now() - make_interval(days => $1))
             OR (revoked_at IS NOT NULL AND revoked_at < now() - make_interval(days => $1))`,
        [RETENTION.sessions],
      );
      return r.rowCount ?? 0;
    },
  },
  {
    label: "만료 로그인 코드",
    run: async (sql) => {
      const r = await sql.query(
        `DELETE FROM login_codes WHERE created_at < now() - make_interval(days => $1)`,
        [RETENTION.loginCodes],
      );
      return r.rowCount ?? 0;
    },
  },
  {
    label: "기한 지난 초대 회수",
    run: async (sql) => {
      // 만료됐지만 아직 열려 있는 초대를 닫는다. 행은 감사 목적으로 남긴다.
      const r = await sql.query(
        `UPDATE invites SET revoked_at = now()
          WHERE claimed_at IS NULL AND revoked_at IS NULL AND expires_at < now()`,
      );
      return r.rowCount ?? 0;
    },
  },
  {
    label: "오래된 초대 기록",
    run: async (sql) => {
      const r = await sql.query(
        `DELETE FROM invites
          WHERE (claimed_at IS NOT NULL OR revoked_at IS NOT NULL)
            AND created_at < now() - make_interval(days => $1)`,
        [RETENTION.invites],
      );
      return r.rowCount ?? 0;
    },
  },
  {
    label: "모델 원문 정리",
    run: async (sql) => {
      // 등록이 끝난 세션의 raw_model_output 은 디버깅 가치가 사라지고 원문만 남는다.
      const r = await sql.query(
        `UPDATE import_extractions e SET raw_model_output = NULL
           FROM import_sessions s
          WHERE s.id = e.import_session_id
            AND s.status = 'IMPORTED'
            AND e.raw_model_output IS NOT NULL
            AND e.created_at < now() - make_interval(days => $1)`,
        [RETENTION.rawModelOutput],
      );
      return r.rowCount ?? 0;
    },
  },
  {
    label: "방치된 봇 대화",
    run: async (sql) => {
      // 대화만 닫는다. 사진·원문이 붙은 ImportSession 은 남겨두고 관리자가 마무리한다
      // (완전히 방치된 것은 아래 purgeAbandonedImports 가 보관 기간 뒤에 지운다).
      const r = await sql.query(
        `UPDATE telegram_import_sessions SET state = 'EXPIRED'
          WHERE state IN ('WAITING_MEDIA', 'WAITING_TEXT', 'READY')
            AND last_activity_at < now() - make_interval(hours => $1)`,
        [TELEGRAM_SESSION_TTL_HOURS],
      );
      return r.rowCount ?? 0;
    },
  },
  {
    label: "오래된 봇 연결 코드",
    run: async (sql) => {
      const r = await sql.query(
        `DELETE FROM telegram_link_codes
          WHERE created_at < now() - make_interval(days => $1)`,
        [RETENTION.telegramLinkCodes],
      );
      return r.rowCount ?? 0;
    },
  },
  {
    label: "오래된 webhook 이벤트",
    run: async (sql) => {
      const r = await sql.query(
        `DELETE FROM telegram_webhook_events
          WHERE received_at < now() - make_interval(days => $1)`,
        [RETENTION.telegramWebhookEvents],
      );
      return r.rowCount ?? 0;
    },
  },
  {
    label: "오래된 감사 로그",
    run: async (sql) => {
      const r = await sql.query(
        `DELETE FROM audit_logs WHERE created_at < now() - make_interval(days => $1)`,
        [RETENTION.auditLogs],
      );
      return r.rowCount ?? 0;
    },
  },
];

/**
 * 등록되지 않고 방치된 Import 세션과 그 원본 사진을 지운다.
 * 파일을 먼저 지우고 행을 지운다 — 반대로 하면 참조를 잃은 파일이 영원히 남는다.
 */
export async function purgeAbandonedImports(
  sql: Sql,
  storageRoot: string,
): Promise<{
  sessions: number;
  files: number;
  skipped: number;
}> {
  const candidates = await sql.query<{ id: string; storage_key: string | null }>(
    `SELECT s.id, a.storage_key
       FROM import_sessions s
       LEFT JOIN import_assets a ON a.import_session_id = s.id
      WHERE s.committed_profile_id IS NULL
        AND s.status <> 'IMPORTED'
        AND s.updated_at < now() - make_interval(days => $1)`,
    [RETENTION.abandonedImports],
  );
  if (candidates.rowCount === 0) return { sessions: 0, files: 0, skipped: 0 };

  const sessionIds = [...new Set(candidates.rows.map((r) => r.id))];
  const keys = candidates.rows.map((r) => r.storage_key).filter((k): k is string => k != null);

  // 프로필 사진이 참조하는 키는 제외한다 — 지우면 게시된 사진이 깨진다.
  const referenced = new Set<string>();
  if (keys.length > 0) {
    const inUse = await sql.query<{ storage_key: string }>(
      `SELECT storage_key FROM profile_images WHERE storage_key = ANY($1)`,
      [keys],
    );
    for (const row of inUse.rows) referenced.add(row.storage_key);
  }

  let files = 0;
  for (const key of new Set(keys)) {
    if (referenced.has(key)) continue;
    const full = path.resolve(storageRoot, key);
    // 경로 탈출 방지 — DB 값이라도 그대로 믿지 않는다.
    if (full !== storageRoot && !full.startsWith(storageRoot + path.sep)) {
      console.warn(`건너뜀(경로 이탈): ${key}`);
      continue;
    }
    await rm(full, { force: true });
    files += 1;
  }

  // import_assets 는 ON DELETE CASCADE 로 함께 사라진다.
  const deleted = await sql.query(`DELETE FROM import_sessions WHERE id = ANY($1)`, [
    sessionIds,
  ]);
  return { sessions: deleted.rowCount ?? 0, files, skipped: referenced.size };
}

export type CleanupSummary = { label: string; count: number }[];

/** 전 단계를 순서대로 실행하고 처리 건수를 돌려준다. */
export async function runCleanup(sql: Sql, storageRoot: string): Promise<CleanupSummary> {
  const summary: CleanupSummary = [];
  for (const step of STEPS) {
    const count = await step.run(sql);
    if (count > 0) summary.push({ label: step.label, count });
  }
  const purged = await purgeAbandonedImports(sql, storageRoot);
  if (purged.sessions > 0) {
    summary.push({ label: "방치된 Import 세션", count: purged.sessions });
    if (purged.files > 0) summary.push({ label: "삭제한 원본 사진", count: purged.files });
    if (purged.skipped > 0)
      summary.push({ label: "보존한 사진(프로필이 사용 중)", count: purged.skipped });
  }
  return summary;
}
