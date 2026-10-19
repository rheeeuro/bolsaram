/**
 * 주선자 프로필 목록 한 페이지.
 *
 * 첫 페이지는 화면(`/profiles`)이 서버에서 그리고, 이어지는 페이지는 스크롤이 끝에
 * 닿을 때 `/api/admin/profiles/list` 가 준다. 둘이 같은 함수를 써야 공개 단계와
 * 카드 모양이 페이지마다 달라지지 않는다.
 */
import "server-only";
import type { Sql } from "@bolsaram/db";
import { isDiscoverable } from "@bolsaram/domain";
import type { AdminProfileQuery } from "@bolsaram/schemas";
import type { Viewer } from "../auth/guard";
import { introducedWithManaged } from "../repo/matches";
import { canEditProfiles, findAdminProfiles } from "../repo/profiles";
import { sourceTextsFor } from "../repo/imports";
import { disclosureFor, toDetailView, type ProfileDetailView } from "./profile-view";
import { label } from "@/lib/labels";
import type { RawListItem } from "@/components/host/profile-raw-list";

export type HostListMode = "card" | "raw";

/** 카드 한 장에 필요한 값만. 공개 단계를 이미 통과한 view 에서 옮긴다. */
export type HostProfileCardItem = {
  id: string;
  code: string;
  /** 담당일 때만 온다. 주선자는 번호보다 이름으로 기억한다. */
  name: string | null;
  gender: string;
  birthYear: number;
  height: number | null;
  /** 직함(없으면 직업군) · 사는 곳. 비어 있을 수 있다. */
  workLine: string;
  imageUrl: string | null;
  visible: boolean;
  createdAt: string;
  bumpedAt: string | null;
};

export type HostProfilePage = {
  total: number;
  nextCursor: string | null;
} & ({ mode: "card"; items: HostProfileCardItem[] } | { mode: "raw"; items: RawListItem[] });

export async function loadHostProfilePage(
  sql: Sql,
  viewer: Viewer,
  query: AdminProfileQuery,
  mode: HostListMode,
): Promise<HostProfilePage> {
  const result = await findAdminProfiles(sql, query, { groupId: viewer.groupId });
  // 전체공개 풀에는 남이 등록한 프로필도 함께 있다. 담당이 아니면 이름·연락처를
  // 가린다 — 판정은 멤버 경로와 같은 함수가 한다.
  const editable = await canEditProfiles(
    sql,
    result.items.map((p) => p.id),
  );
  const introducedWith = await introducedWithManaged(sql);
  const views = result.items.map((profile) => ({
    profile,
    canEdit: editable.has(profile.id),
    view: toDetailView(
      profile,
      disclosureFor({
        profile,
        viewerRole: "ADMIN",
        viewerUserId: viewer.userId,
        introducedWith,
        canEdit: editable.has(profile.id),
      }),
    ),
    // 상태와 노출은 직교한다 — 「공개」인데 안 보이는 조합이 있으므로
    // 두 값을 따로 읽게 두지 않고 결론을 낸다.
    visible: isDiscoverable({ status: profile.status }),
  }));

  if (mode === "raw") {
    // 원본은 볼 때만 읽는다. 카드 보기에는 쓰지 않는 값이고, 프로필 수만큼의
    // 원문을 매번 끌어올 이유가 없다.
    const sources = await sourceTextsFor(
      sql,
      result.items.map((p) => p.id),
    );
    return {
      mode,
      total: result.total,
      nextCursor: result.nextCursor,
      items: views.map((item) =>
        toRawItem({ ...item, source: sources.get(item.profile.id) ?? null }),
      ),
    };
  }

  return {
    mode,
    total: result.total,
    nextCursor: result.nextCursor,
    items: views.map(({ profile, view, visible }) => ({
      id: view.id,
      code: view.code,
      name: view.realName ?? null,
      gender: view.gender,
      birthYear: view.birthYear,
      height: view.height ?? null,
      workLine: workLine(view),
      imageUrl: view.primaryImage?.url ?? null,
      visible,
      // 등록 시각은 개인정보가 아니라 담당이 아니어도 보인다.
      createdAt: profile.createdAt.toISOString(),
      // 목록은 끌어올린 순서로 선다. 날짜가 순서와 어긋나 보이지 않게 함께 싣는다.
      bumpedAt: profile.bumpedAt?.toISOString() ?? null,
    })),
  };
}

/** 카드 셋째 줄. 직함이 있으면 직업군보다 먼저 쓴다. */
function workLine(view: ProfileDetailView): string {
  return [
    view.jobTitle ?? label.jobCategory(view.jobCategory),
    label.residence(view.residenceRegion, view.residenceDistrict),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * 목록 항목을 원본 보기의 한 줄로 옮긴다.
 * 사진은 공개 단계가 이미 걸러 준 것만 쓴다 — 담당이 아닌 프로필은 대표 한 장이다.
 */
function toRawItem(item: {
  view: ProfileDetailView;
  canEdit: boolean;
  visible: boolean;
  source: { source: string; rawText: string | null; committedAt: Date | null } | null;
}): RawListItem {
  const images = item.view.images ?? (item.view.primaryImage ? [item.view.primaryImage] : []);
  return {
    id: item.view.id,
    code: item.view.code,
    name: item.view.realName ?? null,
    gender: item.view.gender,
    birthYear: item.view.birthYear,
    visible: item.visible,
    images: images.map((image) => ({ id: image.id, url: image.url })),
    rawText: item.source?.rawText ?? null,
    // 가져오기 원본은 올린 주선자만 읽는다(RLS). 같은 모임이어도 남이 올린 건
    // 원문이 오지 않으므로, 「글이 없다」가 아니라 「볼 수 없다」로 안내한다.
    sourceHidden: !item.canEdit,
    summary: summaryText(item.view),
    source: item.source?.source ?? null,
    at: item.source?.committedAt?.toISOString() ?? null,
  };
}

/**
 * 원문이 없을 때 대신 보여줄 줄글. 카카오톡 프로필처럼 「항목: 값」 줄로 쓴다.
 *
 * view 는 공개 단계를 이미 통과한 값이라 담당이 아니면 이름·연락처가 들어 있지 않다 —
 * 그래서 남이 올린 원문을 열지 않고도 같은 내용을 훑을 수 있다. 여기서 더 걸러내지 않는다.
 */
function summaryText(view: ProfileDetailView): string | null {
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
