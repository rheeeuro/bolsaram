/** 단계적 정보 공개 (설계문서 §5, 부트스트랩 §12 「auth」). */
import { describe, expect, it } from "vitest";
import {
  ageFromBirthYear,
  assertOppositeGender,
  formatPublicCode,
  isDetailAccessible,
  isDiscoverable,
  isOppositeGender,
  oppositeGender,
  projectProfile,
  type FullProfile,
} from "@bolsaram/domain";
import { disclosureFor } from "../apps/web/src/server/views/profile-view";
import type { ProfileRecord } from "../apps/web/src/server/repo/profiles";

const profile: FullProfile = {
  id: "p1",
  publicCode: 17,
  gender: "FEMALE",
  birthYear: 1993,
  height: 167,
  jobTitle: "마케터",
  jobCategory: "MARKETING",
  company: "가온컴퍼니",
  education: "OO대학교 학사",
  residenceRegion: "SEOUL",
  workplaceRegion: "GYEONGGI",
  religion: "NONE",
  mbti: "ENFP",
  smoking: "NONE",
  drinking: "OCCASIONAL",
  hobbies: ["러닝", "전시"],
  bio: "소개 문장",
  idealTypeText: "이상형 문장",
  realName: "가상이름",
  contactNote: "카카오톡 ID: sample",
  status: "ACTIVE",
  visibility: "LISTED",
  images: [
    { id: "i2", storageKey: "k2", sortOrder: 1, isPrimary: false },
    { id: "i1", storageKey: "k1", sortOrder: 0, isPrimary: true },
  ],
};

describe("projectProfile", () => {
  it("LIST 단계는 리스트 필드만 노출한다", () => {
    const view = projectProfile(profile, "LIST");
    expect(view.publicCode).toBe(17);
    expect(view.height).toBe(167);
    expect(view.jobCategory).toBe("MARKETING");
    // 상세 전용 필드는 키 자체가 없어야 한다.
    for (const key of ["bio", "company", "mbti", "idealTypeText", "realName", "contactNote"]) {
      expect(view).not.toHaveProperty(key);
    }
  });

  it("LIST 단계는 대표 사진 한 장만 준다", () => {
    const view = projectProfile(profile, "LIST");
    expect(view.images).toHaveLength(1);
    expect(view.images?.[0]?.id).toBe("i1");
  });

  it("DETAIL 단계는 소개까지 열되 이름·연락처는 감춘다", () => {
    const view = projectProfile(profile, "DETAIL");
    expect(view.bio).toBe("소개 문장");
    expect(view.mbti).toBe("ENFP");
    expect(view.images).toHaveLength(2);
    expect(view).not.toHaveProperty("realName");
    expect(view).not.toHaveProperty("contactNote");
  });

  it("INTRODUCED 단계에서만 이름과 연락처가 열린다", () => {
    const view = projectProfile(profile, "INTRODUCED");
    expect(view.realName).toBe("가상이름");
    expect(view.contactNote).toBe("카카오톡 ID: sample");
  });

  it("ADMIN/OWNER 는 전체를 본다", () => {
    for (const level of ["ADMIN", "OWNER"] as const) {
      const view = projectProfile(profile, level);
      expect(view.realName).toBe("가상이름");
      expect(view.status).toBe("ACTIVE");
    }
  });

  it("대표 사진이 없으면 정렬 순서가 가장 앞선 사진을 쓴다", () => {
    const view = projectProfile(
      {
        ...profile,
        images: [
          { id: "z", storageKey: "kz", sortOrder: 3, isPrimary: false },
          { id: "y", storageKey: "ky", sortOrder: 1, isPrimary: false },
        ],
      },
      "LIST",
    );
    expect(view.images?.[0]?.id).toBe("y");
  });
});

describe("노출 규칙", () => {
  it("공개 + LISTED 만 Discover 에 나온다", () => {
    expect(isDiscoverable(profile)).toBe(true);
    expect(isDiscoverable({ ...profile, visibility: "UNLISTED" })).toBe(false);
    expect(isDiscoverable({ ...profile, status: "PAUSED" })).toBe(false);
  });

  it("UNLISTED 는 링크로 상세 접근이 가능하다", () => {
    expect(isDetailAccessible({ ...profile, visibility: "UNLISTED" })).toBe(true);
    expect(isDetailAccessible({ ...profile, visibility: "PRIVATE" })).toBe(false);
    expect(isDetailAccessible({ ...profile, status: "ARCHIVED" })).toBe(false);
  });
});

describe("표시 헬퍼", () => {
  it("익명 코드는 # 를 붙인다", () => {
    // 기호는 해시태그(`#등산`)의 것이다. 번호는 기호 없이 쓰고 아이콘으로 가른다.
    expect(formatPublicCode(17)).toBe("17번");
  });

  it("만 나이는 기준 연도에서 뺀다", () => {
    expect(ageFromBirthYear(1993, new Date("2026-09-07T00:00:00Z"))).toBe(33);
  });
});

describe("이성 경계", () => {
  it("성별이 다르면 볼 수 있고 같으면 볼 수 없다", () => {
    expect(isOppositeGender("MALE", "FEMALE")).toBe(true);
    expect(isOppositeGender("FEMALE", "MALE")).toBe(true);
    expect(isOppositeGender("MALE", "MALE")).toBe(false);
    expect(isOppositeGender("FEMALE", "FEMALE")).toBe(false);
  });

  it("이성은 나머지 하나다 — 목록 쿼리가 이 값으로 좁힌다", () => {
    expect(oppositeGender("MALE")).toBe("FEMALE");
    expect(oppositeGender("FEMALE")).toBe("MALE");
  });

  it("같은 성별에게 보내려 하면 막는다", () => {
    expect(() => assertOppositeGender("MALE", "MALE")).toThrow();
    expect(() => assertOppositeGender("MALE", "FEMALE")).not.toThrow();
  });
});

/**
 * 대행(대신 둘러보기)은 주선자 계정으로 멤버 화면을 연다. 공개 단계까지 주선자
 * 기준으로 매기면 담당이라는 이유로 이름·연락처가 그 화면에 뜨고, 옆에서 함께 보는
 * 멤버에게 그대로 보인다.
 */
describe("대행 중 공개 단계", () => {
  const record = (id: string, userId: string | null = null) =>
    ({ ...profile, id, userId, groupId: null }) as unknown as ProfileRecord;

  it("담당 프로필이어도 이름이 열리지 않는다", () => {
    expect(
      disclosureFor({
        profile: record("px"),
        viewerRole: "MEMBER",
        viewerUserId: "host",
        viewerProfileId: "pm",
        introducedWith: new Set(),
        canEdit: true,
      }),
    ).toBe("DETAIL");
  });

  it("주선자가 맡은 다른 멤버의 연결을 끌어오지 않는다", () => {
    // 대행 경로는 그 멤버의 연결만 담아 부른다. 담기지 않았으면 DETAIL 이다.
    expect(
      disclosureFor({
        profile: record("px"),
        viewerRole: "MEMBER",
        viewerUserId: "host",
        viewerProfileId: "pm",
        introducedWith: new Set(["py"]),
        canEdit: true,
      }),
    ).toBe("DETAIL");
  });

  it("대행 대상 본인의 프로필은 OWNER 다", () => {
    expect(
      disclosureFor({
        profile: record("pm", "member-user"),
        viewerRole: "MEMBER",
        viewerUserId: "host",
        viewerProfileId: "pm",
        introducedWith: new Set(),
      }),
    ).toBe("OWNER");
  });

  it("주선자 화면은 그대로 담당이면 전부 본다", () => {
    expect(
      disclosureFor({
        profile: record("px"),
        viewerRole: "ADMIN",
        viewerUserId: "host",
        introducedWith: new Set(),
        canEdit: true,
      }),
    ).toBe("ADMIN");
  });
});
