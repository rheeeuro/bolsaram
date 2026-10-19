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
import type { AiMatch } from "../services/recommend-service";
import { signDownloadUrl } from "../storage/local";
import { label } from "../../lib/labels";

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
  /** 보는 멤버의 이상형 조건으로 서버가 고른 「AI 추천」인가. 멤버 탐색에서만 채운다. */
  aiRecommended: boolean;
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
  hashtags: string[];
  bio: string | null;
  idealTypeText: string | null;
  /** 주선자가 쓴 소개 한마디. 공개 단계는 소개·이상형과 같다. */
  hostComment: string | null;
  /** INTRODUCED 이후에만 채워진다. */
  realName?: string | null;
  contactNote?: string | null;
  /** 서울·경기의 구·시·군. 주선자·본인 단계에서만 채운다. */
  residenceDistrict?: string | null;
  status?: string;
  /** AI 추천 이유. 멤버 상세에서 추천일 때만 채운다. */
  aiMatch: AiMatch | null;
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
  options: { isFavorited?: boolean; aiRecommended?: boolean } = {},
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
    aiRecommended: options.aiRecommended ?? false,
  };
}

/**
 * 멤버 탐색의 「원본으로 보기」 한 줄. 카드 값에 사진 전체와 정리된 줄글을 더한다.
 *
 * 상세 화면과 같은 `DETAIL` 단계로 고정한다 — 목록은 익명 탐색이라 연결된 상대여도
 * 이름·연락처를 싣지 않는다. 가져올 때 받은 원문은 이름·연락처가 섞여 있어 쓰지 않는다.
 */
export type ProfileRawView = ProfileCardView & {
  images: ProfileImageView[];
  summary: string | null;
};

export function toRawView(
  profile: ProfileRecord,
  options: { isFavorited?: boolean; aiRecommended?: boolean } = {},
): ProfileRawView {
  const detail = toDetailView(profile, "DETAIL");
  return {
    ...toCardView(profile, options),
    images: detail.images,
    summary: profileSummaryText(detail),
  };
}

export function toDetailView(
  profile: ProfileRecord,
  level: DisclosureLevel,
  options: { isFavorited?: boolean; aiMatch?: AiMatch | null } = {},
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
    aiRecommended: options.aiMatch != null,
    aiMatch: options.aiMatch ?? null,
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
    hashtags: view.hashtags ?? [],
    bio: view.bio ?? null,
    idealTypeText: view.idealTypeText ?? null,
    hostComment: view.hostComment ?? null,
  };

  if (level === "INTRODUCED" || level === "ADMIN" || level === "OWNER") {
    base.realName = view.realName ?? null;
    base.contactNote = view.contactNote ?? null;
  }
  if (level === "ADMIN" || level === "OWNER") {
    base.residenceDistrict = profile.residenceDistrict;
    base.status = profile.status;
  }
  return base;
}

/**
 * 열람자 기준의 공개 단계를 정한다.
 * 담당 주선자 > 본인 > 연결된 상대 > 일반 멤버 순으로 내려간다.
 *
 * **대행 중에는 멤버 경로로 부른다.** 주선자 계정으로 열지만 화면은 그 멤버의 것이라,
 * 담당이라는 이유로 이름·연락처를 열거나 그 주선자가 맡은 **다른** 멤버의 연결을
 * 끌어오면 옆에서 함께 보는 사람에게 그대로 보인다.
 *
 * **주선자라는 사실만으로 전부 열지 않는다.** 전체공개 풀은 모든 주선자가 보지만
 * 고치는 것은 등록한 사람뿐이고(0011), 가입은 열려 있다. 담당이 아닌 프로필의
 * 이름·연락처는 멤버와 같은 기준으로 가린다 — 자기가 맡은 멤버와 연결된 뒤에야
 * 열린다. 그 전에 필요하면 대행으로 멤버 화면에서 보고, 그 사실은 감사에 남는다.
 */
export function disclosureFor(input: {
  profile: ProfileRecord;
  viewerRole: "ADMIN" | "MEMBER";
  viewerUserId: string;
  /**
   * 멤버로서 보고 있는 프로필. 대행 중에는 계정이 아니라 이 값이 「본인」을 가린다 —
   * 주선자 계정으로 열지만 화면의 주인은 대행 대상이다.
   */
  viewerProfileId?: string | null;
  introducedWith: Set<string>;
  /** 주선자가 이 프로필을 고칠 수 있는가. 멤버 경로에서는 보지 않는다. */
  canEdit?: boolean;
}): DisclosureLevel {
  if (input.viewerRole === "ADMIN") {
    if (input.canEdit) return "ADMIN";
    return input.introducedWith.has(input.profile.id) ? "INTRODUCED" : "DETAIL";
  }
  if (input.profile.id === input.viewerProfileId) return "OWNER";
  if (input.profile.userId === input.viewerUserId) return "OWNER";
  if (input.introducedWith.has(input.profile.id)) return "INTRODUCED";
  return "DETAIL";
}

/**
 * 원본 보기에 싣는 줄글. 카카오톡 프로필처럼 「항목: 값」 줄로 쓴다.
 * 주선자 「받은 원본」은 원문이 없을 때, 멤버 「원본으로 보기」는 늘 이것을 쓴다.
 *
 * view 는 공개 단계를 이미 통과한 값이라 담당이 아니면 이름·연락처가 들어 있지 않다 —
 * 그래서 남이 올린 원문을 열지 않고도 같은 내용을 훑을 수 있다. 여기서 더 걸러내지 않는다.
 */
export function profileSummaryText(view: ProfileDetailView): string | null {
  const job = [view.jobTitle ?? label.jobCategory(view.jobCategory), view.company]
    .filter(Boolean)
    .join(" · ");
  const lines: [string, string | null][] = [
    ["나이", label.birthYear(view.birthYear)],
    ["키", view.height ? `${view.height}cm` : null],
    ["직업", job || null],
    ["학력", view.education],
    ["사는 곳", label.residence(view.residenceRegion, view.residenceDistrict)],
    ["직장 지역", label.region(view.workplaceRegion)],
    ["종교", label.religion(view.religion)],
    ["MBTI", view.mbti],
    ["흡연", label.smoking(view.smoking)],
    ["음주", label.drinking(view.drinking)],
    ["취미", view.hobbies.length > 0 ? view.hobbies.join(", ") : null],
    ["이상형", view.idealTypeText],
  ];
  const blocks = [
    lines
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n"),
    view.bio,
    view.hostComment ? `주선자 한마디: ${view.hostComment}` : null,
    view.hashtags.length > 0 ? view.hashtags.map((tag) => `#${tag}`).join(" ") : null,
  ].filter((block): block is string => Boolean(block?.trim()));
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}
