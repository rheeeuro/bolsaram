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

export default async function ProfileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
      backHref="/discover"
    />
  );
}

export function generateMetadata() {
  // 상세 페이지는 개인정보를 담으므로 제목에 아무 것도 흘리지 않는다.
  return { title: "프로필 · 볼사람", robots: { index: false, follow: false } };
}
