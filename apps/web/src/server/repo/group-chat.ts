/**
 * 모임 채팅방 저장소 (마이그레이션 0040).
 *
 * 방의 경계는 모임이고 참여자 명단은 `group_admins` 다 — 여기서 따로 확인하지 않고
 * RLS(`app_is_group_admin`)가 판정한다. 속하지 않은 모임의 방은 조용히 비어 보이고,
 * 쓰기는 정책이 막는다. 그와 별개로 라우트가 `requireGroupAdmin` 으로 한 번 더 막는다.
 *
 * 메시지는 고칠 수 없다. 지우기만 되고, 그것도 자기 것만이다(DB 가드 트리거).
 */
import "server-only";
import type { Sql } from "@bolsaram/db";
import { DomainError } from "@bolsaram/domain";

export type GroupMessageRecord = {
  id: string;
  authorUserId: string | null;
  /** 작성자 이름. 계정이 지워졌으면 null 이다. */
  authorName: string | null;
  body: string;
  createdAt: Date;
  deleted: boolean;
};

type Row = {
  id: string;
  author_user_id: string | null;
  author_name: string | null;
  body: string;
  created_at: Date;
  deleted_at: Date | null;
};

const SELECT_MESSAGE = `SELECT m.id, m.author_user_id, u.display_name AS author_name,
                               m.body, m.created_at, m.deleted_at
                          FROM group_messages m
                          LEFT JOIN users u ON u.id = m.author_user_id`;

function toRecord(row: Row): GroupMessageRecord {
  return {
    id: row.id,
    authorUserId: row.author_user_id,
    authorName: row.author_name,
    // 지운 메시지의 본문은 DB 에도 없다. 화면에서 자리만 남긴다.
    body: row.deleted_at ? "" : row.body,
    createdAt: row.created_at,
    deleted: row.deleted_at !== null,
  };
}

/**
 * 방의 메시지. 항상 오래된 것부터 돌려준다 — 화면이 그 순서로 쌓는다.
 *
 *   before  위로 거슬러 올라갈 때. 그 시각 **직전** 것들을 가져와 뒤집는다.
 *   after   열어 둔 화면의 폴링. 그 시각 **이후** 것들.
 *   (없음)  최근 한 페이지.
 */
export async function listMessages(
  sql: Sql,
  groupId: string,
  query: { before?: string; after?: string; limit: number },
): Promise<GroupMessageRecord[]> {
  if (query.after) {
    const result = await sql.query<Row>(
      `${SELECT_MESSAGE}
        WHERE m.group_id = $1 AND m.created_at > $2
        ORDER BY m.created_at LIMIT $3`,
      [groupId, query.after, query.limit],
    );
    return result.rows.map(toRecord);
  }

  const result = await sql.query<Row>(
    `${SELECT_MESSAGE}
      WHERE m.group_id = $1 AND ($2::timestamptz IS NULL OR m.created_at < $2)
      ORDER BY m.created_at DESC LIMIT $3`,
    [groupId, query.before ?? null, query.limit],
  );
  return result.rows.map(toRecord).reverse();
}

/**
 * 메시지를 남긴다. 작성자를 인자로 받지 않는 이유는 RLS 가 자기 자신만 허용하기
 * 때문이다 — 남의 이름으로 쓰는 경로를 애초에 만들지 않는다.
 */
export async function createMessage(
  sql: Sql,
  groupId: string,
  authorUserId: string,
  body: string,
): Promise<GroupMessageRecord> {
  const inserted = await sql.query<{ id: string }>(
    `INSERT INTO group_messages (group_id, author_user_id, body)
     VALUES ($1, $2, $3) RETURNING id`,
    [groupId, authorUserId, body],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new DomainError("FORBIDDEN", "이 모임에 글을 남길 수 없습니다.");

  const result = await sql.query<Row>(`${SELECT_MESSAGE} WHERE m.id = $1`, [id]);
  return toRecord(result.rows[0]!);
}

/**
 * 자기 메시지를 지운다. 행은 남고 본문만 사라진다(가드 트리거가 비운다) —
 * 대화의 흐름을 끊지 않으려는 것이다.
 */
export async function deleteMessage(sql: Sql, groupId: string, messageId: string): Promise<void> {
  const result = await sql.query(
    `UPDATE group_messages SET deleted_at = now()
      WHERE id = $1 AND group_id = $2 AND deleted_at IS NULL`,
    [messageId, groupId],
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new DomainError("NOT_FOUND", "이미 지웠거나 내가 쓴 메시지가 아닙니다.");
  }
}

export type GroupChatPrefsRecord = {
  lastReadAt: Date | null;
  telegramNotify: boolean;
};

/** 행이 없으면 「전부 안 읽음, 알림 꺼짐」이다. */
export async function readPrefs(
  sql: Sql,
  groupId: string,
  userId: string,
): Promise<GroupChatPrefsRecord> {
  const result = await sql.query<{ last_read_at: Date; telegram_notify: boolean }>(
    `SELECT last_read_at, telegram_notify FROM group_chat_prefs
      WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId],
  );
  const row = result.rows[0];
  return {
    lastReadAt: row ? row.last_read_at : null,
    telegramNotify: row ? row.telegram_notify : false,
  };
}

/**
 * 읽은 위치·알림 설정을 바꾼다. 보낸 것만 바뀐다.
 *
 * 읽은 위치는 뒤로 가지 않는다(`GREATEST`) — 여러 탭이 열려 있으면 늦게 도착한
 * 요청이 옛 시각을 들고 올 수 있다. 행을 새로 만들 때 읽은 위치의 기본값이
 * `-infinity` 인 것도 같은 이유다. 알림만 켜다가 쌓인 것을 읽음 처리하면 안 된다.
 */
export async function updatePrefs(
  sql: Sql,
  groupId: string,
  userId: string,
  input: { readUpTo?: string; telegramNotify?: boolean },
): Promise<GroupChatPrefsRecord> {
  const result = await sql.query<{ last_read_at: Date; telegram_notify: boolean }>(
    `INSERT INTO group_chat_prefs (group_id, user_id, last_read_at, telegram_notify)
     VALUES ($1, $2, COALESCE($3::timestamptz, '-infinity'), COALESCE($4::boolean, false))
     ON CONFLICT (group_id, user_id) DO UPDATE
       SET last_read_at = GREATEST(
             group_chat_prefs.last_read_at,
             COALESCE($3::timestamptz, group_chat_prefs.last_read_at)
           ),
           telegram_notify = COALESCE($4::boolean, group_chat_prefs.telegram_notify)
     RETURNING last_read_at, telegram_notify`,
    [groupId, userId, input.readUpTo ?? null, input.telegramNotify ?? null],
  );
  const row = result.rows[0];
  if (!row) throw new DomainError("FORBIDDEN", "이 모임의 설정을 바꿀 수 없습니다.");
  return { lastReadAt: row.last_read_at, telegramNotify: row.telegram_notify };
}

export type GroupUnread = { groupId: string; unread: number };

/**
 * 속한 모임 전부의 안 읽은 개수. 상단 네비 배지가 쓴다.
 *
 * 내가 쓴 것과 지워진 것은 세지 않는다. 읽은 위치가 없으면 방의 전부가 안 읽음이다.
 */
export async function unreadByGroup(sql: Sql, userId: string): Promise<GroupUnread[]> {
  const result = await sql.query<{ group_id: string; unread: number }>(
    `SELECT ga.group_id,
            (SELECT count(*)::int FROM group_messages m
              WHERE m.group_id = ga.group_id
                AND m.deleted_at IS NULL
                AND m.author_user_id IS DISTINCT FROM $1
                AND m.created_at > COALESCE(p.last_read_at, '-infinity'::timestamptz)
            ) AS unread
       FROM group_admins ga
       LEFT JOIN group_chat_prefs p
         ON p.group_id = ga.group_id AND p.user_id = ga.user_id
      WHERE ga.user_id = $1`,
    [userId],
  );
  return result.rows.map((row) => ({ groupId: row.group_id, unread: row.unread }));
}
