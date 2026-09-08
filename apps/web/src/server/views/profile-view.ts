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
  /** 등록 동의 기록. 주선자에게만 보인다 — 공개 가능 여부를 화면이 알아야 한다. */
  consent?: { method: string | null; confirmedAt: string | null };
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
  if (level === "ADMIN") {
    base.consent = {
      method: profile.consent.method,
      confirmedAt: profile.consent.confirmedAt?.toISOString() ?? null,
    };
  }
  return base;
}

/**
 * 열람자 기준의 공개 단계를 정한다.
 * 관리자 > 본인 > 연결된 상대 > 일반 회원 순으로 내려간다.
 */
export function disclosureFor(input: {
  profile: ProfileRecord;
  viewerRole: "ADMIN" | "MEMBER";
  viewerUserId: string;
  introducedWith: Set<string>;
}): DisclosureLevel {
  if (input.viewerRole === "ADMIN") return "ADMIN";
  if (input.profile.userId === input.viewerUserId) return "OWNER";
  if (input.introducedWith.has(input.profile.id)) return "INTRODUCED";
  return "DETAIL";
}
