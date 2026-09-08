/**
 * 열거형 → 한글 라벨 조회. UI 는 이 함수만 쓰고 enums 를 직접 인덱싱하지 않는다.
 * 알 수 없는 값이 와도 화면이 깨지지 않게 원문을 그대로 돌려준다.
 */
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
  bio: "자기소개",
  idealTypeText: "이상형",
  realName: "이름",
  contactNote: "연락 방법",
};
