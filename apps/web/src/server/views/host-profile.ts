/**
 * 주선자 화면이 프로필 하나를 읽는 방법.
 *
 * 상세(`/profiles/[id]`)와 편집(`/profiles/[id]/edit`)이 서로 다른 라우트다. 권한과
 * 공개 단계 판정을 양쪽에 옮겨 적으면 「볼 수 있는데 못 고치는」 조합이 화면마다
 * 달라지므로 한 곳에서만 정한다.
 */
import "server-only";
import { withRls } from "@bolsaram/db";
import { rlsContextOf, type Viewer } from "../auth/guard";
import { introducedWithManaged } from "../repo/matches";
import { canEditProfiles, findProfileById } from "../repo/profiles";
import { disclosureFor, toDetailView, type ProfileDetailView } from "./profile-view";

export type HostProfileData = {
  /** 등록한 주선자인가. 전체공개 풀은 모두가 보지만 고치는 것은 등록한 사람뿐이다(0011). */
  canEdit: boolean;
  view: ProfileDetailView;
  /**
   * 운영 상태는 개인정보가 아니라 담당이 아니어도 보인다. 공개 단계가 낮아지면
   * `view` 에서 빠지므로 레코드에서 직접 싣는다.
   */
  status: string;
  visibility: string;
  claimed: boolean;
  /** 담당일 때만 읽는다. 초대는 등록한 주선자만 발급한다. */
  invite: { expiresAt: string; claimed: boolean } | null;
};

export async function loadHostProfile(
  viewer: Viewer,
  id: string,
): Promise<HostProfileData | null> {
  return withRls(rlsContextOf(viewer), async (sql) => {
    const profile = await findProfileById(sql, id);
    if (!profile) return null;

    const canEdit = (await canEditProfiles(sql, [profile.id])).has(profile.id);
    const level = disclosureFor({
      profile,
      viewerRole: "ADMIN",
      viewerUserId: viewer.userId,
      // 담당이면 이미 ADMIN 단계라 연결 여부를 물을 필요가 없다.
      introducedWith: canEdit ? new Set<string>() : await introducedWithManaged(sql),
      canEdit,
    });

    const invite = canEdit
      ? await sql.query<{ expires_at: Date; claimed_at: Date | null }>(
          `SELECT expires_at, claimed_at FROM invites
            WHERE profile_id = $1 AND revoked_at IS NULL
            ORDER BY created_at DESC LIMIT 1`,
          [profile.id],
        )
      : null;
    const latest = invite?.rows[0];

    return {
      canEdit,
      view: toDetailView(profile, level),
      status: profile.status,
      visibility: profile.visibility,
      claimed: profile.userId != null,
      invite: latest
        ? { expiresAt: latest.expires_at.toISOString(), claimed: latest.claimed_at != null }
        : null,
    };
  });
}
