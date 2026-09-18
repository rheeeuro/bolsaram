/**
 * 열거형 → 한글 라벨 조회. UI 는 이 함수만 쓰고 enums 를 직접 인덱싱하지 않는다.
 * 알 수 없는 값이 와도 화면이 깨지지 않게 원문을 그대로 돌려준다.
 */
import { formatPublicCode } from "@bolsaram/domain";
import type { GroupMessagePayload, GroupMessageSystemKind } from "@bolsaram/schemas";
import {
  DRINKING_LABELS,
  GENDER_LABELS,
  IMPORT_SOURCE_LABELS,
  IMPORT_STATUS_LABELS,
  JOB_CATEGORY_LABELS,
  MATCH_REQUEST_STATUS_LABELS,
  PROFILE_STATUS_LABELS,
  REGION_LABELS,
  RELIGION_LABELS,
  SMOKING_LABELS,
  VISIBILITY_LABELS,
} from "@bolsaram/schemas";

function lookup(map: Record<string, string>, value: string | null | undefined): string | null {
  if (value == null) return null;
  return map[value] ?? value;
}

export const label = {
  gender: (v: string | null | undefined) => lookup(GENDER_LABELS, v),
  region: (v: string | null | undefined) => lookup(REGION_LABELS, v),
  jobCategory: (v: string | null | undefined) => lookup(JOB_CATEGORY_LABELS, v),
  religion: (v: string | null | undefined) => lookup(RELIGION_LABELS, v),
  smoking: (v: string | null | undefined) => lookup(SMOKING_LABELS, v),
  drinking: (v: string | null | undefined) => lookup(DRINKING_LABELS, v),
  profileStatus: (v: string | null | undefined) => lookup(PROFILE_STATUS_LABELS, v),
  visibility: (v: string | null | undefined) => lookup(VISIBILITY_LABELS, v),
  matchStatus: (v: string | null | undefined) => lookup(MATCH_REQUEST_STATUS_LABELS, v),
  importStatus: (v: string | null | undefined) => lookup(IMPORT_STATUS_LABELS, v),
  importSource: (v: string | null | undefined) => lookup(IMPORT_SOURCE_LABELS, v),
};

/** AI 추출 필드 키 → 검토 화면에 쓸 한글 이름. */
export const FIELD_LABELS: Record<string, string> = {
  gender: "성별",
  birthYear: "출생연도",
  height: "키",
  jobTitle: "직업",
  jobCategory: "직업군",
  company: "회사",
  education: "학력",
  residenceRegion: "거주 지역",
  workplaceRegion: "직장 지역",
  religion: "종교",
  mbti: "MBTI",
  smoking: "흡연",
  drinking: "음주",
  hobbies: "취미",
  hashtags: "해시태그",
  bio: "자기소개",
  idealTypeText: "이상형",
  realName: "이름",
  contactNote: "연락 방법",
};

/**
 * 모임 채팅방의 시스템 메시지 (마이그레이션 0044).
 *
 * DB 에는 종류와 값만 있고 문장은 여기서 만든다. 멤버는 **공개 번호로만** 부른다 —
 * 방에 이름을 적지 않기로 한 규칙이 시스템 메시지에도 그대로 적용된다.
 *
 * 문장을 통째로 돌려주지 않고 토막으로 나누는 이유는 **번호에 링크를 달기 위해서다** —
 * 번호 토막만 그 프로필로 가는 링크가 되고 나머지는 그대로 글이 된다. 어디로 가는지는
 * 화면이 정한다(여기서는 주소를 모른다).
 */
export type GroupSystemMessagePart =
  | { kind: "text"; text: string }
  /** 멤버 공개 번호. `code` 가 null 이면 payload 에 없던 것이라 링크를 달 수 없다. */
  | { kind: "code"; text: string; code: number | null };

export function groupSystemMessageParts(
  kind: GroupMessageSystemKind,
  payload: GroupMessagePayload,
): GroupSystemMessagePart[] {
  const who = payload.actorName?.trim() ? payload.actorName.trim() : "주선자";
  const text = (value: string): GroupSystemMessagePart => ({ kind: "text", text: value });
  const code = (value: number | null | undefined): GroupSystemMessagePart => ({
    kind: "code",
    text: value == null ? "?번" : formatPublicCode(value),
    code: value ?? null,
  });

  switch (kind) {
    case "ADMIN_JOINED":
      return [text(`${who} 님이 모임에 들어왔습니다.`)];
    case "ADMIN_LEFT":
      return [text(`${who} 님이 모임에서 나갔습니다.`)];
    case "ADMIN_REMOVED": {
      const target = payload.targetName?.trim() ? payload.targetName.trim() : "주선자";
      return [text(`${who} 님이 ${target} 님을 모임에서 내보냈습니다.`)];
    }
    case "OWNER_TRANSFERRED":
      return [text(`${who} 님이 모임장이 됐습니다.`)];
    case "PROFILE_REGISTERED":
      return [code(payload.profileCode), text(` 멤버가 등록됐습니다. (${who})`)];
    case "MATCH_REQUESTED":
      return [
        code(payload.requesterCode),
        text(" → "),
        code(payload.targetCode),
        text(" 소개를 신청했습니다."),
      ];
    case "MATCH_INTRODUCED":
      return [
        code(payload.requesterCode),
        text(" ↔ "),
        code(payload.targetCode),
        text(" 연결됐습니다."),
      ];
  }
}
