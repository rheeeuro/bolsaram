/**
 * 단계적 정보 공개 규칙 (설계문서 §5).
 * LIST      — 익명 코드, 대표 사진, 출생연도, 키, 직업군, 넓은 지역
 * DETAIL    — 사진, 직업/회사, 학력, 지역, 종교, MBTI, 흡연/음주, 취미, 소개, 이상형
 * INTRODUCED— 이름/연락 방식까지
 *
 * 이 파일은 순수 함수만 둔다. 실제 차단은 SQL(RLS) + API 권한 검사가 함께 담당한다.
 */
import type { ProfileStatus, Visibility } from "@bolsaram/schemas";

export type DisclosureLevel = "LIST" | "DETAIL" | "INTRODUCED" | "OWNER" | "ADMIN";

export type FullProfile = {
  id: string;
  publicCode: number;
  gender: string;
  birthYear: number;
  height: number | null;
  jobTitle: string | null;
  jobCategory: string | null;
  company: string | null;
  education: string | null;
  residenceRegion: string;
  workplaceRegion: string | null;
  religion: string | null;
  mbti: string | null;
  smoking: string | null;
  drinking: string | null;
  hobbies: string[];
  bio: string | null;
  idealTypeText: string | null;
  realName: string | null;
  contactNote: string | null;
  status: ProfileStatus;
  visibility: Visibility;
  images: { id: string; storageKey: string; sortOrder: number; isPrimary: boolean }[];
};

const LIST_FIELDS = [
  "id",
  "publicCode",
  "gender",
  "birthYear",
  "height",
  "jobCategory",
  "residenceRegion",
] as const;

const DETAIL_EXTRA_FIELDS = [
  "jobTitle",
  "company",
  "education",
  "workplaceRegion",
  "religion",
  "mbti",
  "smoking",
  "drinking",
  "hobbies",
  "bio",
  "idealTypeText",
] as const;

/** 이 단계에 도달해야만 노출되는 개인 식별 정보. */
const IDENTITY_FIELDS = ["realName", "contactNote"] as const;

export type ProfileView = Partial<FullProfile> & {
  id: string;
  publicCode: number;
  disclosure: DisclosureLevel;
};

/**
 * 공개 단계에 맞춰 필드를 걸러낸다.
 * 걸러진 필드는 null 로 채우지 않고 아예 키를 없앤다 — 클라이언트가 "값 없음"과
 * "볼 권한 없음"을 구분할 수 있어야 하고, 실수로 직렬화되는 경로를 줄이기 위해서다.
 */
export function projectProfile(profile: FullProfile, level: DisclosureLevel): ProfileView {
  if (level === "ADMIN" || level === "OWNER") {
    return { ...profile, disclosure: level };
  }

  const view: Record<string, unknown> = { disclosure: level };
  for (const key of LIST_FIELDS) view[key] = profile[key];

  if (level === "LIST") {
    view.images = primaryImageOnly(profile);
    return view as ProfileView;
  }

  for (const key of DETAIL_EXTRA_FIELDS) view[key] = profile[key];
  view.images = profile.images;

  if (level === "INTRODUCED") {
    for (const key of IDENTITY_FIELDS) view[key] = profile[key];
  }
  return view as ProfileView;
}

function primaryImageOnly(profile: FullProfile): FullProfile["images"] {
  const primary =
    profile.images.find((i) => i.isPrimary) ??
    [...profile.images].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  return primary ? [primary] : [];
}

/** 회원이 Discover 에서 볼 수 있는 프로필인지. */
export function isDiscoverable(profile: {
  status: ProfileStatus;
  visibility: Visibility;
}): boolean {
  return (
    (profile.status === "ACTIVE" || profile.status === "MATCHING") &&
    profile.visibility === "LISTED"
  );
}

/** 상세 페이지 직접 접근 허용 여부. UNLISTED 는 링크가 있으면 볼 수 있다. */
export function isDetailAccessible(profile: {
  status: ProfileStatus;
  visibility: Visibility;
}): boolean {
  return (
    (profile.status === "ACTIVE" || profile.status === "MATCHING") &&
    profile.visibility !== "PRIVATE"
  );
}

/** 익명 코드 표기. 리스트/상세 모두 `#17` 형태로 통일한다. */
export function formatPublicCode(code: number): string {
  return `#${code}`;
}

/** 출생연도 → 한국식 나이 계산에 쓰이는 만 나이. */
export function ageFromBirthYear(birthYear: number, now = new Date()): number {
  return now.getFullYear() - birthYear;
}
