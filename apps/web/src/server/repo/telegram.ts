/**
 * 텔레그램 봇 대화 저장소 (설계 변경 문서 TELEGRAM v1 §6·§7).
 *
 * 여기 있는 모든 함수는 **연결된 주선자 명의의 withRls 트랜잭션 안에서** 호출된다.
 * webhook 이 RLS 를 우회하지 않는다는 뜻이다 — 신원 확인만 인증 레이어
 * (`auth/telegram.ts`, owner 커넥션)에서 하고 그 뒤는 일반 관리자 요청과 같다.
 *
 * 상태 전이 판정은 @bolsaram/domain 의 assertTelegramTransition 이 담당한다.
 */
import "server-only";
import type { Sql } from "@bolsaram/db";
import { DomainError, assertTelegramTransition } from "@bolsaram/domain";
import { TELEGRAM_SESSION_TTL_HOURS } from "@bolsaram/domain";
import type { TelegramSessionState } from "@bolsaram/schemas";

export type TelegramConversationRecord = {
  id: string;
  importSessionId: string;
  telegramUserId: number;
  telegramChatId: number;
  lastMediaGroupId: string | null;
  state: TelegramSessionState;
  lastActivityAt: Date;
  createdAt: Date;
};

type ConversationRow = {
  id: string;
  import_session_id: string;
  telegram_user_id: number;
  telegram_chat_id: number;
  last_media_group_id: string | null;
  state: TelegramSessionState;
  last_activity_at: Date;
  created_at: Date;
};

const CONVERSATION_COLUMNS = `id, import_session_id, telegram_user_id, telegram_chat_id,
  last_media_group_id, state, last_activity_at, created_at`;

function toConversation(row: ConversationRow): TelegramConversationRecord {
  return {
    id: row.id,
    importSessionId: row.import_session_id,
    telegramUserId: Number(row.telegram_user_id),
    telegramChatId: Number(row.telegram_chat_id),
    lastMediaGroupId: row.last_media_group_id,
    state: row.state,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
  };
}

/**
 * 진행 중인 대화. 부분 유니크 인덱스(one_active)가 하나만 존재함을 보장하므로
 * 여기서 "가장 최근" 을 고를 필요가 없다.
 */
export async function findActiveConversation(
  sql: Sql,
  telegramUserId: number,
): Promise<TelegramConversationRecord | null> {
  const result = await sql.query<ConversationRow>(
    `SELECT ${CONVERSATION_COLUMNS} FROM telegram_import_sessions
      WHERE telegram_user_id = $1
        AND state IN ('WAITING_MEDIA', 'WAITING_TEXT', 'READY')`,
    [telegramUserId],
  );
  const row = result.rows[0];
  return row ? toConversation(row) : null;
}

export async function findConversationByImportSession(
  sql: Sql,
  importSessionId: string,
): Promise<TelegramConversationRecord | null> {
  const result = await sql.query<ConversationRow>(
    `SELECT ${CONVERSATION_COLUMNS} FROM telegram_import_sessions
      WHERE import_session_id = $1`,
    [importSessionId],
  );
  const row = result.rows[0];
  return row ? toConversation(row) : null;
}

export async function createConversation(
  sql: Sql,
  input: { importSessionId: string; telegramUserId: number; telegramChatId: number },
): Promise<TelegramConversationRecord> {
  const result = await sql.query<ConversationRow>(
    `INSERT INTO telegram_import_sessions
       (import_session_id, telegram_user_id, telegram_chat_id)
     VALUES ($1, $2, $3) RETURNING ${CONVERSATION_COLUMNS}`,
    [input.importSessionId, input.telegramUserId, input.telegramChatId],
  );
  return toConversation(result.rows[0]!);
}

/**
 * 대화 상태와 마지막 앨범 식별자를 갱신하고 활동 시각을 새로 찍는다.
 * 전이 가능 여부는 도메인이 판정하고, DB 에는 조건부 UPDATE 로 적용한다 —
 * 같은 대화에 update 두 개가 동시에 들어와도 기대한 상태에서만 바뀐다.
 */
export async function updateConversation(
  sql: Sql,
  conversation: TelegramConversationRecord,
  changes: { state?: TelegramSessionState; lastMediaGroupId?: string | null },
): Promise<TelegramConversationRecord> {
  const nextState = changes.state ?? conversation.state;
  assertTelegramTransition(conversation.state, nextState);

  const result = await sql.query<ConversationRow>(
    `UPDATE telegram_import_sessions
        SET state = $3,
            last_media_group_id = COALESCE($4, last_media_group_id),
            last_activity_at = now()
      WHERE id = $1 AND state = $2
      RETURNING ${CONVERSATION_COLUMNS}`,
    [conversation.id, conversation.state, nextState, changes.lastMediaGroupId ?? null],
  );
  const row = result.rows[0];
  if (!row) {
    throw new DomainError("CONFLICT", "대화 상태가 이미 바뀌었습니다. 다시 시도해 주세요.");
  }
  return toConversation(row);
}

/**
 * 방치된 대화를 만료시킨다. 정리 작업(`pnpm db:cleanup`)과 봇의 `/new` 가 함께 쓴다.
 * ImportSession 행은 건드리지 않는다 — 미완성 Import 정리는 기존 보관 정책이 담당한다.
 */
export async function expireStaleConversations(sql: Sql): Promise<number> {
  const result = await sql.query(
    `UPDATE telegram_import_sessions
        SET state = 'EXPIRED'
      WHERE state IN ('WAITING_MEDIA', 'WAITING_TEXT', 'READY')
        AND last_activity_at < now() - make_interval(hours => $1)`,
    [TELEGRAM_SESSION_TTL_HOURS],
  );
  return result.rowCount ?? 0;
}

// ── 계정 연결 (관리자 화면용) ─────────────────────────────────
// webhook 의 신원 확인은 auth/telegram.ts 가 owner 커넥션으로 한다.
// 여기 있는 것은 주선자가 자기 연결 상태를 보고 끊는 경로뿐이다.

export type TelegramConnectionRecord = {
  telegramUserId: number;
  linkedAt: Date;
  lastSeenAt: Date | null;
};

export async function findConnectionForUser(
  sql: Sql,
  userId: string,
): Promise<TelegramConnectionRecord | null> {
  const result = await sql.query<{
    telegram_user_id: number;
    linked_at: Date;
    last_seen_at: Date | null;
  }>(
    `SELECT telegram_user_id, linked_at, last_seen_at
       FROM telegram_connections WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  return row
    ? {
        telegramUserId: Number(row.telegram_user_id),
        linkedAt: row.linked_at,
        lastSeenAt: row.last_seen_at,
      }
    : null;
}

/** 연결 해제. 진행 중이던 대화도 함께 닫는다 — 끊었는데 대화가 살아 있으면 안 된다. */
export async function deleteConnectionForUser(sql: Sql, userId: string): Promise<boolean> {
  const removed = await sql.query<{ telegram_user_id: number }>(
    `DELETE FROM telegram_connections WHERE user_id = $1 RETURNING telegram_user_id`,
    [userId],
  );
  const row = removed.rows[0];
  if (!row) return false;
  await sql.query(
    `UPDATE telegram_import_sessions SET state = 'CANCELED'
      WHERE telegram_user_id = $1
        AND state IN ('WAITING_MEDIA', 'WAITING_TEXT', 'READY')`,
    [row.telegram_user_id],
  );
  return true;
}
