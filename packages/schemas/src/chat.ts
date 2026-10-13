/**
 * 모임 채팅방 (마이그레이션 0040).
 *
 * 주선자 전용 운영 채널이다. 멤버는 들어오지 않으므로 여기 스키마에는
 * 프로필·연락처가 등장하지 않는다 — 본문 텍스트 하나뿐이다.
 */
import { z } from "zod";
import { GROUP_CHAT_NOTIFY_MODES, GROUP_MESSAGE_SYSTEM_KINDS } from "./enums";

/** DB CHECK(`group_messages_body_sane`)와 같은 값. 한쪽만 바꾸면 저장에서 터진다. */
export const GROUP_MESSAGE_MAX_LENGTH = 2000;

/** 한 번에 읽어오는 개수. 방을 열 때와 「이전 대화」 모두 이 크기다. */
export const GROUP_MESSAGE_PAGE_SIZE = 50;

export const groupMessageCreateSchema = z.object({
  body: z.string().trim().min(1).max(GROUP_MESSAGE_MAX_LENGTH),
});
export type GroupMessageCreate = z.infer<typeof groupMessageCreateSchema>;

/**
 * 목록 조회.
 *
 *   (없음)   최근 한 페이지
 *   before   그 시각보다 이전 — 위로 거슬러 올라간다
 *
 * 앞으로 오는 것은 묻지 않는다. 새 글은 스트림이 밀어준다(0043).
 * 커서가 id 가 아니라 시각인 것은 화면이 시각으로 정렬하기 때문이다.
 */
export const groupMessageQuerySchema = z.object({
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(GROUP_MESSAGE_PAGE_SIZE),
});
export type GroupMessageQuery = z.infer<typeof groupMessageQuerySchema>;

/**
 * 본문 안의 멘션 — 두 가지다.
 *
 *   `@이름`  이 모임의 주선자. 이름은 주선자 표시 이름 그대로다(띄어쓰기 포함).
 *   `#23`    이 모임의 멤버. `#` 뒤에 공개 번호를 붙이고, 뒤의 「번」은 있어도 된다.
 *
 * 저장하는 것은 글 그대로다. 누구를 가리키는지는 **읽을 때** RLS 를 통과해 붙는다
 * (`hostIds` · `profileIds`) — 볼 수 없는 번호나 지금 모임에 없는 이름은 글자로 남는다.
 * 주선자 이름은 정해진 모양이 없어서 정규식으로 뽑지 않고, 서버가 알려 준 이름을
 * 본문에서 찾는다(긴 이름부터).
 *
 * 멤버 멘션은 앞이 글자·숫자면 멘션이 아니다(`a#23`). 서버의 같은 판정은
 * `server/repo/group-chat.ts` 의 SQL 정규식이다 — 한쪽만 바꾸면 화면이 링크를 달 자리와
 * 서버가 번호를 풀어 주는 자리가 어긋난다.
 */
export const GROUP_MESSAGE_MEMBER_TAG = /(?<![\p{L}\p{N}_])#(\d{1,9})(번)?/gu;

/** 멘션을 고를 때 한 번에 보여주는 후보 수. */
export const GROUP_MENTION_LIMIT = 6;

/**
 * 주선자 후보는 한 방에 많지 않으므로 넉넉히 준다. 입력창이 이 목록으로 `@이름` 을
 * 알아보고 색을 입히므로 잘리면 그 사람의 멘션만 색이 빠진다.
 */
export const GROUP_MENTION_HOST_LIMIT = 50;

/** 주선자 이름으로 치는 앞자리의 최대 길이. 표시 이름 길이보다 넉넉하다. */
export const GROUP_MENTION_HOST_QUERY_MAX = 40;

/**
 * 멘션 후보 조회.
 *
 *   kind=host    `@` — 이 모임 주선자를 이름 앞자리로(나는 빼고)
 *   kind=member  `#` — 이 모임 멤버를 번호 앞자리로
 *
 * `q` 가 비어 있으면 처음부터 보여준다.
 */
export const groupMentionQuerySchema = z
  .object({
    kind: z.enum(["host", "member"]),
    q: z.string().trim().max(GROUP_MENTION_HOST_QUERY_MAX).default(""),
  })
  .refine((v) => v.kind !== "member" || /^\d{0,9}$/.test(v.q), {
    message: "멤버는 번호로 찾습니다.",
    path: ["q"],
  });
export type GroupMentionQuery = z.infer<typeof groupMentionQuerySchema>;

/**
 * 시스템 메시지가 싣는 것 (마이그레이션 0044).
 *
 * 전부 선택이다 — 종류마다 채우는 것이 다르다. 멤버는 공개 번호로만 등장하고
 * 이름이 들어가는 자리는 **주선자뿐**이다 — `actorName` 이 그 일을 한 사람이고,
 * 내보내기에서만 대상이 따로 있어 `targetName` 이 붙는다.
 * 나간 주선자는 나중에 `users` 에서 읽을 수 없어서 그때 값을 적어 둔다.
 */
export const groupMessagePayloadSchema = z.object({
  actorName: z.string().nullish(),
  targetName: z.string().nullish(),
  profileCode: z.number().int().nullish(),
  requesterCode: z.number().int().nullish(),
  targetCode: z.number().int().nullish(),
});
export type GroupMessagePayload = z.infer<typeof groupMessagePayloadSchema>;

export const groupMessageSystemKindSchema = z.enum(GROUP_MESSAGE_SYSTEM_KINDS);

/**
 * DB 가 `pg_notify` 로 알리는 채팅 변화 (마이그레이션 0043).
 *
 * 이 채널은 **권한 판정을 거치지 않는다** — 듣는 커넥션 하나가 모든 방의 사건을
 * 받는다. 그래서 본문이 실리지 않고 「어느 방에서 무엇이 바뀌었다」만 온다.
 * 받는 쪽이 자기 컨텍스트로 다시 읽어야 내용을 알 수 있다.
 *
 * DB 가 만든 값이지만 밖에서 들어오는 payload 와 같은 규칙으로 검증한다.
 */
export const groupChatNotifySchema = z.object({
  kind: z.enum(["created", "deleted"]),
  groupId: z.uuid(),
  messageId: z.uuid(),
  /** 놓친 구간을 되짚는 커서. 저장 정밀도와 같은 밀리초다(0042). */
  at: z.iso.datetime(),
});
export type GroupChatNotify = z.infer<typeof groupChatNotifySchema>;

/**
 * 내 방 상태. 보낸 필드만 바꾼다.
 *
 *   readUpTo  여기까지 읽었다(배지에서 뺀다)
 *   notify    이 방의 텔레그램 알림 — 모든 새 메시지 · 멘션만 · 끄기(0068).
 *             텔레그램을 연결한 사람만 바꿀 수 있다.
 */
export const groupChatPrefsSchema = z
  .object({
    readUpTo: z.iso.datetime().optional(),
    notify: z.enum(GROUP_CHAT_NOTIFY_MODES).optional(),
  })
  .refine((v) => v.readUpTo !== undefined || v.notify !== undefined, {
    message: "바꿀 항목이 없습니다.",
  });
export type GroupChatPrefs = z.infer<typeof groupChatPrefsSchema>;
