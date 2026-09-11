/**
 * 숨긴 사람 목록 (마이그레이션 0023).
 *
 * 하단 탭에 넣지 않고 「내 프로필」에서만 들어온다 — 평소에 볼 화면이 아니고, 탭을
 * 늘리면 탐색·관심·시그널의 무게가 흐려진다.
 *
 * 해제는 여기서 바로 하지 않고 상세 화면에서 한다. 목록에서 한 번의 탭으로 풀리면
 * 실수로 다시 보이게 되고, 해제 문구를 두 곳에 적어야 한다.
 */
import { withRls } from "@bolsaram/db";
import { requireUserPage, rlsContextOf } from "@/server/auth/guard";
import { Empty } from "@/components/ui/empty";
import { ProfileCard } from "@/components/member/profile-card";
import { MemberHeader } from "@/components/member/member-header";
import { hiddenProfileIds } from "@/server/repo/hides";
import { findProfilesByIds } from "@/server/repo/profiles";
import { toCardView } from "@/server/views/profile-view";

export const dynamic = "force-dynamic";

export default async function HiddenPage() {
  const viewer = await requireUserPage("/hidden");

  const items = viewer.profileId
    ? await withRls(rlsContextOf(viewer), async (sql) => {
        const ids = await hiddenProfileIds(sql, viewer.profileId!);
        const profiles = await findProfilesByIds(sql, ids);
        const byId = new Map(profiles.map((p) => [p.id, p]));
        // 숨긴 순서를 유지한다. RLS 로 걸러진 프로필은 자연스럽게 빠진다.
        return ids
          .map((id) => byId.get(id))
          .filter((p): p is NonNullable<typeof p> => p != null)
          .map((p) => toCardView(p));
      })
    : [];

  return (
    <>
      <MemberHeader title="숨긴 사람" back={{ href: "/me", label: "뒤로" }} />

      <main className="mx-auto max-w-3xl px-4 pt-4">
        {items.length === 0 ? (
          <Empty
            title="숨긴 사람이 없습니다"
            description="프로필 상세 아래의 「이 분 숨기기」를 누르면 여기에 모입니다."
          />
        ) : (
          <>
            <p className="pb-4 text-[12.5px] leading-relaxed text-[var(--color-ink-600)]">
              숨긴 분은 탐색 목록에 보이지 않고 서로 마음을 보낼 수 없습니다. 카드를 열어
              숨김을 해제할 수 있습니다.
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-6 pb-8 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((profile) => (
                <ProfileCard key={profile.id} profile={profile} from="hidden" />
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}

export function generateMetadata() {
  return { title: "숨긴 사람 · 볼사람", robots: { index: false, follow: false } };
}
