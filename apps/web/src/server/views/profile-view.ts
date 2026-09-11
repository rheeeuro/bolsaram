/**
 * 프로필을 클라이언트로 내보내는 형태로 변환한다.
 * 공개 단계 판정은 도메인의 projectProfile 이 하고, 여기서는 이미지 signed URL 을 붙인다.
 * 영구 URL 을 만들지 않는다 — 매 응답마다 단기 서명 URL 을 새로 발급한다.
 */
import "server-only";
import {
  ageFromBirthYear,
  formatPublicCode,
  projectProfile,
  type DisclosureLevel,
} from "@bolsaram/domain";
import type { ProfileRecord } from "../repo/profiles";
import { signDownloadUrl } from "../storage/local";

export type ProfileImageView = { id: string; url: string; isPrimary: boolean };

export type ProfileCardView = {
  id: string;
  code: string;
  age: number;
  birthYear: number;
  gender: string;
  height: number | null;
  jobCategory: string | null;
  residenceRegion: string;
  primaryImage: ProfileImageView | null;
  isFavorited: boolean;
};

export type ProfileDetailView = ProfileCardView & {
  disclosure: DisclosureLevel;
  images: ProfileImageView[];
  jobTitle: string | null;
  company: string | null;
  education: string | null;
  workplaceRegion: string | null;
  religion: string | null;
  mbti: string | null;
  smoking: string | null;
  drinking: string | null;
  hobbies: string[];
  bio: string | null;
  idealTypeText: string | null;
  /** INTRODUCED 이후에만 채워진다. */
  realName?: string | null;
  contactNote?: string | null;
  status?: string;
  visibility?: string;
};

function toImageView(image: {
  id: string;
  storageKey: string;
  isPrimary: boolean;
}): ProfileImageView {
  return { id: image.id, url: signDownloadUrl(image.storageKey), isPrimary: image.isPrimary };
}

export function toCardView(
  profile: ProfileRecord,
  options: { isFavorited?: boolean } = {},
): ProfileCardView {
  const view = projectProfile(profile, "LIST");
  const images = view.images ?? [];
  return {
    id: profile.id,
    code: formatPublicCode(profile.publicCode),
    age: ageFromBirthYear(profile.birthYear),
    birthYear: profile.birthYear,
    gender: profile.gender,
    height: view.height ?? null,
    jobCategory: view.jobCategory ?? null,
    residenceRegion: profile.residenceRegion,
    primaryImage: images[0] ? toImageView(images[0]) : null,
    isFavorited: options.isFavorited ?? false,
  };
}

export function toDetailView(
  profile: ProfileRecord,
  level: DisclosureLevel,
  options: { isFavorited?: boolean } = {},
): ProfileDetailView {
  const view = projectProfile(profile, level);
  const images = (view.images ?? []).map(toImageView);
  const base: ProfileDetailView = {
    id: profile.id,
    code: formatPublicCode(profile.publicCode),
    age: ageFromBirthYear(profile.birthYear),
    birthYear: profile.birthYear,
    gender: profile.gender,
    height: view.height ?? null,
    jobCategory: view.jobCategory ?? null,
    residenceRegion: profile.residenceRegion,
    primaryImage: images.find((i) => i.isPrimary) ?? images[0] ?? null,
    isFavorited: options.isFavorited ?? false,
    disclosure: level,
    images,
    jobTitle: view.jobTitle ?? null,
    company: view.company ?? null,
    education: view.education ?? null,
    workplaceRegion: view.workplaceRegion ?? null,
    religion: view.religion ?? null,
    mbti: view.mbti ?? null,
    smoking: view.smoking ?? null,
    drinking: view.drinking ?? null,
    hobbies: view.hobbies ?? [],
    bio: view.bio ?? null,
    idealTypeText: view.idealTypeText ?? null,
  };

  if (level === "INTRODUCED" || level === "ADMIN" || level === "OWNER") {
    base.realName = view.realName ?? null;
    base.contactNote = view.contactNote ?? null;
  }
  if (level === "ADMIN" || level === "OWNER") {
    base.status = profile.status;
    base.visibility = profile.visibility;
  }
  return base;
}

/**
 * 열람자 기준의 공개 단계를 정한다.
 * 담당 주선자 > 본인 > 연결된 상대 > 일반 회원 순으로 내려간다.
 *
 * **주선자라는 사실만으로 전부 열지 않는다.** 전체공개 풀은 모든 주선자가 보지만
 * 고치는 것은 등록한 사람뿐이고(0011), 가입은 열려 있다. 담당이 아닌 프로필의
 * 이름·연락처는 회원과 같은 기준으로 가린다 — 자기가 맡은 회원과 연결된 뒤에야
 * 열린다. 그 전에 필요하면 대행으로 회원 화면에서 보고, 그 사실은 감사에 남는다.
 */
export function disclosureFor(input: {
  profile: ProfileRecord;
  viewerRole: "ADMIN" | "MEMBER";
  viewerUserId: string;
  introducedWith: Set<string>;
  /** 주선자가 이 프로필을 고칠 수 있는가. 회원 경로에서는 보지 않는다. */
  canEdit?: boolean;
}): DisclosureLevel {
  if (input.viewerRole === "ADMIN") {
    if (input.canEdit) return "ADMIN";
    return input.introducedWith.has(input.profile.id) ? "INTRODUCED" : "DETAIL";
  }
  if (input.profile.userId === input.viewerUserId) return "OWNER";
  if (input.introducedWith.has(input.profile.id)) return "INTRODUCED";
  return "DETAIL";
}
