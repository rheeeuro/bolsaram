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
import { z } from "zod";
import type { Sql } from "@bolsaram/db";
import { DomainError } from "@bolsaram/domain";
import {
  GROUP_CHAT_NOTIFY_DEFAULT,
  groupMessagePayloadSchema,
  type GroupChatNotifyMode,
  type GroupMessagePayload,
  type GroupMessageSystemKind,
} from "@bolsaram/schemas";

export type GroupMessageRecord = {
  id: string;
  /** 어느 방의 글인가. 스트림은 여러 방의 사건을 한 줄로 보내므로 필요하다. */
  groupId: string;
  authorUserId: string | null;
  /** 작성자 이름. 계정이 지워졌으면 null 이다. */
  authorName: string | null;
  /** 작성자 프로필 사진의 저장 키. 화면으로 보내기 전에 단기 signed URL 로 바꾼다. */
  authorAvatarKey: string | null;
  body: string;
  createdAt: Date;
  deleted: boolean;
  /** 사람이 쓴 글이면 null. 값이 있으면 DB 가 남긴 사건이다(0044). */
  systemKind: GroupMessageSystemKind | null;
  /** 시스템 메시지가 싣는 것. 사람의 글에서는 비어 있다. */
  payload: GroupMessagePayload;
  /**
   * 공개 번호 → 프로필 id. 화면이 번호에 링크를 달 때 쓴다. 시스템 메시지는 payload 의
   * 번호, 사람의 글은 본문의 멤버 멘션(`#23`)가 대상이다.
   *
   * **볼 수 있는 것만 들어온다** — 조회가 RLS 를 통과하므로 지워졌거나 담당 채널을
   * 벗어난 번호는 빠진다. 그런 번호는 링크 없이 글자로만 남는다.
   */
  profileIds: Record<string, string>;
  /**
   * 본문에서 멘션된(`@이름`) 주선자 — 표시 이름 → 사용자 id. 지금 이 모임에 있는
   * 주선자만 들어온다. 나간 사람이나 이름을 바꾼 사람의 멘션은 글자로 남는다.
   */
  hostIds: Record<string, string>;
};

type Row = {
  id: string;
  group_id: string;
  author_user_id: string | null;
  author_name: string | null;
  author_avatar_key: string | null;
  body: string;
  created_at: Date;
  deleted_at: Date | null;
  system_kind: GroupMessageSystemKind | null;
  payload: unknown;
  profile_ids: unknown;
  host_ids: unknown;
};

/**
 * 글에 나오는 공개 번호를 프로필 id 로 바꿔 함께 읽는다.
 *
 * 시스템 메시지의 payload 에는 번호만 있다(0044) — 이름을 적지 않기로 한 규칙이라
 * 그대로 두고, 화면이 링크를 걸 수 있도록 여기서 한 번 더 찾아 준다. 사람이 쓴 글은
 * 본문의 멤버 멘션(`#23`)에서 번호를 뽑는다. 정규식은 화면 쪽 `GROUP_MESSAGE_MEMBER_TAG`
 * 와 같은 판정이다 — 앞이 글자·숫자면 멘션이 아니고, 아홉 자리까지만 본다(int 범위).
 * 지운 글은 본문이 비어 있어 찾을 것이 없다.
 *
 * 번호는 전역에서 유일하므로(`profiles.public_code UNIQUE`) 모임을 따로 묻지 않는다.
 * 볼 수 없는 프로필은 RLS 가 걸러 map 에서 빠진다.
 */
const PROFILE_LINKS = `LEFT JOIN LATERAL (
                           SELECT jsonb_object_agg(p.public_code::text, p.id) AS ids
                             FROM profiles p
                            WHERE p.public_code = ANY (
                                    CASE WHEN m.system_kind IS NOT NULL THEN ARRAY[
                                      (m.payload->>'profileCode')::int,
                                      (m.payload->>'requesterCode')::int,
                                      (m.payload->>'targetCode')::int
                                    ]
                                    ELSE ARRAY(
                                      SELECT tag[2]::int
                                        FROM regexp_matches(m.body, '(^|[^[:alnum:]_])#([0-9]{1,9})', 'g') AS tag
                                    ) END)
                         ) links ON true`;

/**
 * 본문에서 멘션된 주선자(`@이름`). 이름은 모양이 정해져 있지 않아 뽑아내지 않고, 이 방의
 * 주선자 이름이 `@` 뒤에 나오는지를 본다. 화면은 받은 이름을 긴 것부터 본문에서 찾는다.
 * 모임 명단(`group_admins`)과 이름은 같은 모임 주선자에게만 보인다 — RLS 가 판정한다.
 */
const HOST_LINKS = `LEFT JOIN LATERAL (
                        SELECT jsonb_object_agg(h.display_name, h.id) AS ids
                          FROM group_admins ga
                          JOIN users h ON h.id = ga.user_id
                         WHERE ga.group_id = m.group_id
                           AND m.system_kind IS NULL
                           AND COALESCE(h.display_name, '') <> ''
                           AND strpos(m.body, '@' || h.display_name) > 0
                      ) hosts ON true`;

const SELECT_MESSAGE = `SELECT m.id, m.group_id, m.author_user_id, u.display_name AS author_name,
                               u.avatar_key AS author_avatar_key,
                               m.body, m.created_at, m.deleted_at, m.system_kind, m.payload,
                               links.ids AS profile_ids, hosts.ids AS host_ids
                          FROM group_messages m
                          LEFT JOIN users u ON u.id = m.author_user_id
                          ${PROFILE_LINKS}
                          ${HOST_LINKS}`;

/** DB 가 만든 map 이지만 화면으로 나가기 전에 형태를 확인한다. payload 와 같은 규칙이다. */
const profileIdsSchema = z.record(z.string(), z.uuid());
const hostIdsSchema = z.record(z.string(), z.uuid());

function toRecord(row: Row): GroupMessageRecord {
  return {
    id: row.id,
    groupId: row.group_id,
    authorUserId: row.author_user_id,
    authorName: row.author_name,
    authorAvatarKey: row.author_avatar_key,
    // 지운 메시지의 본문은 DB 에도 없다. 화면에서 자리만 남긴다.
    body: row.deleted_at ? "" : row.body,
    createdAt: row.created_at,
    deleted: row.deleted_at !== null,
    systemKind: row.system_kind,
    // DB 가 만든 값이지만 화면으로 나가기 전에 형태를 확인한다. 모양이 어긋나면
    // 문장을 만들지 못할 뿐 목록 전체가 깨지지는 않게 빈 값으로 떨어뜨린다.
    payload: groupMessagePayloadSchema.safeParse(row.payload).data ?? {},
    profileIds: profileIdsSchema.safeParse(row.profile_ids).data ?? {},
    hostIds: hostIdsSchema.safeParse(row.host_ids).data ?? {},
  };
}

/**
 * 방의 메시지. 항상 오래된 것부터 돌려준다 — 화면이 그 순서로 쌓는다.
 *
 *   before  위로 거슬러 올라갈 때. 그 시각 **직전** 것들을 가져와 뒤집는다.
 *   (없음)  최근 한 페이지.
 *
 * 앞으로 오는 것은 여기서 묻지 않는다 — 스트림이 밀어준다(`listMessagesSince`).
 */
export async function listMessages(
  sql: Sql,
  groupId: string,
  query: { before?: string; limit: number },
): Promise<GroupMessageRecord[]> {
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

/**
 * 메시지 하나. 볼 수 없으면 `null` 이다 — RLS 가 판정한다.
 *
 * 스트림이 쓴다. DB 가 알린 사건에는 권한이 없으므로(0043) **보내기 직전에 이 조회로
 * 판정을 받는다.** 속하지 않은 방의 사건은 여기서 조용히 빈 결과가 된다.
 */
export async function readMessage(
  sql: Sql,
  messageId: string,
): Promise<GroupMessageRecord | null> {
  const result = await sql.query<Row>(`${SELECT_MESSAGE} WHERE m.id = $1`, [messageId]);
  const row = result.rows[0];
  return row ? toRecord(row) : null;
}

/**
 * 내가 볼 수 있는 **모든 방**에서 그 시각 이후의 글. 스트림이 끊겼다 붙을 때 놓친
 * 구간을 메운다(`Last-Event-ID`).
 *
 * 모임을 지정하지 않는다 — 어느 방이 보이는지는 RLS 가 `group_admins` 로 정한다.
 */
export async function listMessagesSince(
  sql: Sql,
  since: string,
  limit: number,
): Promise<GroupMessageRecord[]> {
  const result = await sql.query<Row>(
    `${SELECT_MESSAGE} WHERE m.created_at > $1 ORDER BY m.created_at LIMIT $2`,
    [since, limit],
  );
  return result.rows.map(toRecord);
}

export type GroupChatPrefsRecord = {
  lastReadAt: Date | null;
  /** 이 방의 텔레그램 알림(0068). 행이 없으면 기본값(멘션만)이다. */
  notify: GroupChatNotifyMode;
  /** 텔레그램을 연결했는가. 연결하지 않았으면 알림 설정을 바꿀 수 없다. */
  telegramLinked: boolean;
};

type PrefsRow = { last_read_at: Date | null; notify: GroupChatNotifyMode | null; linked: boolean };

/** 내 텔레그램 연결 여부. 연결 행은 본인 것만 보인다(RLS). */
const TELEGRAM_LINKED = `EXISTS (SELECT 1 FROM telegram_connections tc WHERE tc.user_id = $2)`;

function toPrefs(row: PrefsRow | undefined): GroupChatPrefsRecord {
  return {
    lastReadAt: row?.last_read_at ?? null,
    notify: row?.notify ?? GROUP_CHAT_NOTIFY_DEFAULT,
    telegramLinked: row?.linked ?? false,
  };
}

/** 행이 없으면 「전부 안 읽음, 알림은 멘션만」이다. */
export async function readPrefs(
  sql: Sql,
  groupId: string,
  userId: string,
): Promise<GroupChatPrefsRecord> {
  const result = await sql.query<PrefsRow>(
    `SELECT pref.last_read_at, pref.notify, ${TELEGRAM_LINKED} AS linked
       FROM (SELECT 1) one
       LEFT JOIN group_chat_prefs pref ON pref.group_id = $1 AND pref.user_id = $2`,
    [groupId, userId],
  );
  return toPrefs(result.rows[0]);
}

/**
 * 읽은 위치·알림 설정을 바꾼다. 보낸 것만 바뀐다.
 *
 * 읽은 위치는 뒤로 가지 않는다(`GREATEST`) — 여러 탭이 열려 있으면 늦게 도착한
 * 요청이 옛 시각을 들고 올 수 있다. 행을 새로 만들 때 읽은 위치의 기본값이
 * `-infinity` 인 것도 같은 이유다. 알림만 바꾸다가 쌓인 것을 읽음 처리하면 안 된다.
 *
 * 알림은 텔레그램을 연결한 사람만 바꾼다. 화면도 그때만 메뉴를 열지만, 보낼 곳이
 * 없는 설정이 저장되지 않게 여기서도 막는다.
 */
export async function updatePrefs(
  sql: Sql,
  groupId: string,
  userId: string,
  input: { readUpTo?: string; notify?: GroupChatNotifyMode },
): Promise<GroupChatPrefsRecord> {
  if (input.notify !== undefined) {
    const linked = await sql.query<{ linked: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM telegram_connections tc WHERE tc.user_id = $1) AS linked`,
      [userId],
    );
    if (!linked.rows[0]?.linked) {
      throw new DomainError("INVALID_STATE", "텔레그램을 먼저 연결해야 알림을 고를 수 있습니다.");
    }
  }

  const result = await sql.query<PrefsRow>(
    `INSERT INTO group_chat_prefs (group_id, user_id, last_read_at, notify)
     VALUES ($1, $2, COALESCE($3::timestamptz, '-infinity'),
             COALESCE($4::group_chat_notify, 'MENTIONS'))
     ON CONFLICT (group_id, user_id) DO UPDATE
       SET last_read_at = GREATEST(
             group_chat_prefs.last_read_at,
             COALESCE($3::timestamptz, group_chat_prefs.last_read_at)
           ),
           notify = COALESCE($4::group_chat_notify, group_chat_prefs.notify)
     RETURNING last_read_at, notify, ${TELEGRAM_LINKED} AS linked`,
    [groupId, userId, input.readUpTo ?? null, input.notify ?? null],
  );
  const row = result.rows[0];
  if (!row) throw new DomainError("FORBIDDEN", "이 모임의 설정을 바꿀 수 없습니다.");
  return toPrefs(row);
}

export type GroupUnread = { groupId: string; unread: number };

/**
 * 속한 모임 전부의 안 읽은 개수. 상단 네비 배지가 쓴다.
 *
 * 내가 쓴 것과 지워진 것은 세지 않는다. 읽은 위치가 없으면 방의 전부가 안 읽음이다.
 */
export async function unreadByGroup(sql: Sql, userId: string): Promise<GroupUnread[]> {
  const result = await sql.query<{ group_id: string; unread: number }>(
    // 방 목록은 소속이 아니라 `app_is_group_admin` 으로 고른다 — 관리자는 소속 없이
    // 모든 방에 있다(0065). 대행 중에 열리는 멤버 모임(`groups_read`)은 여기 들지 않는다.
    `SELECT g.id AS group_id,
            (SELECT count(*)::int FROM group_messages m
              WHERE m.group_id = g.id
                AND m.deleted_at IS NULL
                AND m.author_user_id IS DISTINCT FROM $1
                AND m.created_at > COALESCE(p.last_read_at, '-infinity'::timestamptz)
            ) AS unread
       FROM groups g
       LEFT JOIN group_chat_prefs p
         ON p.group_id = g.id AND p.user_id = $1
      WHERE app_is_group_admin(g.id)`,
    [userId],
  );
  return result.rows.map((row) => ({ groupId: row.group_id, unread: row.unread }));
}

export type HostMentionCandidate = {
  userId: string;
  name: string;
  isOwner: boolean;
  /** 프로필 사진의 저장 키. 화면으로 보내기 전에 단기 signed URL 로 바꾼다. */
  avatarKey: string | null;
};

/**
 * `@` 멘션 후보 — 이 모임의 주선자를 이름 앞자리로 찾는다. 나는 뺀다.
 *
 * 명단은 RLS 가 같은 모임 주선자에게만 보여주므로 속하지 않은 모임을 물으면 비어 있다.
 * 앞자리 비교는 LIKE 를 쓰지 않는다 — 이름에 `%` `_` 가 들어 있어도 글자 그대로 본다.
 */
export async function listHostMentionCandidates(
  sql: Sql,
  groupId: string,
  viewerId: string,
  prefix: string,
  limit: number,
): Promise<HostMentionCandidate[]> {
  const result = await sql.query<{
    id: string;
    display_name: string;
    is_owner: boolean;
    avatar_key: string | null;
  }>(
    `SELECT u.id, u.display_name, ga.is_owner, u.avatar_key
       FROM group_admins ga
       JOIN users u ON u.id = ga.user_id
      WHERE ga.group_id = $1
        AND u.id <> $2
        AND COALESCE(u.display_name, '') <> ''
        AND lower(left(u.display_name, length($3))) = lower($3)
      ORDER BY ga.is_owner DESC, u.display_name
      LIMIT $4`,
    [groupId, viewerId, prefix, limit],
  );
  return result.rows.map((row) => ({
    userId: row.id,
    name: row.display_name,
    isOwner: row.is_owner,
    avatarKey: row.avatar_key,
  }));
}

export type MentionCandidate = {
  profileId: string;
  code: number;
  gender: string;
  birthYear: number;
  jobTitle: string | null;
  status: string;
  /** 대표 사진의 저장 키. 화면으로 보내기 전에 단기 signed URL 로 바꾼다. */
  photoKey: string | null;
};

/**
 * `#` 멘션 후보 — 이 방의 모임에 등록된 멤버를 번호 앞자리로 찾는다.
 *
 * 모임으로 좁히는 것은 화면의 약속이다. 볼 수 있는지는 RLS 가 정하므로 소속이 아닌
 * 모임을 물으면 비어 돌아온다. 친 번호와 꼭 맞는 사람을 맨 앞에, 나머지는 최근 번호부터.
 * 이름은 싣지 않는다 — 방에서는 번호로만 부른다.
 */
export async function listMentionCandidates(
  sql: Sql,
  groupId: string,
  prefix: string,
  limit: number,
): Promise<MentionCandidate[]> {
  const result = await sql.query<{
    id: string;
    public_code: number;
    gender: string;
    birth_year: number;
    job_title: string | null;
    status: string;
    photo_key: string | null;
  }>(
    `SELECT p.id, p.public_code, p.gender, p.birth_year, p.job_title, p.status,
            (SELECT i.storage_key FROM profile_images i
              WHERE i.profile_id = p.id
              ORDER BY i.is_primary DESC, i.sort_order LIMIT 1) AS photo_key
       FROM profiles p
      WHERE p.group_id = $1
        AND ($2 = '' OR p.public_code::text LIKE $2 || '%')
      ORDER BY (p.public_code::text = $2) DESC, p.public_code DESC
      LIMIT $3`,
    [groupId, prefix, limit],
  );
  return result.rows.map((row) => ({
    profileId: row.id,
    code: row.public_code,
    gender: row.gender,
    birthYear: row.birth_year,
    jobTitle: row.job_title,
    status: row.status,
    photoKey: row.photo_key,
  }));
}
