/** 프로필 상세 (UI 컨셉 04). 큰 사진 + 여백 + serif display. */
import { notFound } from "next/navigation";
import { isDetailAccessible } from "@bolsaram/domain";
import { withRls } from "@bolsaram/db";
import { requireUserPage, rlsContextOf } from "@/server/auth/guard";
import { isFavorited } from "@/server/repo/favorites";
import { findActiveBetween, introducedPartnerIds } from "@/server/repo/matches";
import { findProfileById } from "@/server/repo/profiles";
import { disclosureFor, toDetailView } from "@/server/views/profile-view";
import { ProfileDetail } from "@/components/member/profile-detail";

export const dynamic = "force-dynamic";

/**
 * 돌아갈 수 있는 화면. 쿼리로 들어온 값을 그대로 링크에 쓰지 않고 이 표에서만 고른다 —
 * `from` 은 외부에서 조작할 수 있는 입력이다.
 */
const BACK_TO = { favorites: "/favorites", signals: "/signals" } as const;
const SIGNAL_TABS = ["incoming", "outgoing", "connected"];

function backHrefFrom(from?: string, tab?: string): string {
  const base = BACK_TO[from as keyof typeof BACK_TO];
  if (!base) return "/discover";
  if (base === "/signals" && tab && SIGNAL_TABS.includes(tab)) return `/signals?tab=${tab}`;
  return base;
}

export default async function ProfileDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; tab?: string }>;
}) {
  const { id } = await params;
  const { from, tab } = await searchParams;
  const viewer = await requireUserPage(`/discover/${id}`);

  const data = await withRls(rlsContextOf(viewer), async (sql) => {
    const profile = await findProfileById(sql, id);
    if (!profile) return null;
    if (
      viewer.role !== "ADMIN" &&
      profile.userId !== viewer.userId &&
      !isDetailAccessible(profile)
    ) {
      return null;
    }

    const introducedWith = viewer.profileId
      ? await introducedPartnerIds(sql, viewer.profileId)
      : new Set<string>();
    const level = disclosureFor({
      profile,
      viewerRole: viewer.role,
      viewerUserId: viewer.userId,
      introducedWith,
    });
    const favorited = await isFavorited(sql, viewer.userId, profile.id);
    const existing = viewer.profileId
      ? await findActiveBetween(sql, viewer.profileId, profile.id)
      : null;

    return {
      view: toDetailView(profile, level, { isFavorited: favorited }),
      isSelf: profile.userId === viewer.userId,
      existing: existing
        ? {
            status: existing.status,
            isRequester: existing.requesterProfileId === viewer.profileId,
          }
        : null,
    };
  });

  if (!data) notFound();

  return (
    <ProfileDetail
      profile={data.view}
      isSelf={data.isSelf}
      canRequest={viewer.profileId != null && !data.isSelf}
      existing={data.existing}
      backHref={backHrefFrom(from, tab)}
    />
  );
}

export function generateMetadata() {
  // 상세 페이지는 개인정보를 담으므로 제목에 아무 것도 흘리지 않는다.
  return { title: "프로필 · 볼사람", robots: { index: false, follow: false } };
}
