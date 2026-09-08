/** 관심 목록. Discover 와 같은 카드를 쓴다. */
import Link from "next/link";
import { withRls } from "@bolsaram/db";
import { requireUserPage, rlsContextOf } from "@/server/auth/guard";
import { Empty } from "@/components/ui/empty";
import { ProfileCard } from "@/components/member/profile-card";
import { favoriteProfileIds } from "@/server/repo/favorites";
import { findProfilesByIds } from "@/server/repo/profiles";
import { toCardView } from "@/server/views/profile-view";

export const dynamic = "force-dynamic";

export default async function FavoritesPage() {
  const viewer = await requireUserPage("/favorites");

  const items = await withRls(rlsContextOf(viewer), async (sql) => {
    const ids = await favoriteProfileIds(sql, viewer.userId);
    const profiles = await findProfilesByIds(sql, ids);
    const byId = new Map(profiles.map((p) => [p.id, p]));
    // 저장한 순서를 유지한다. RLS 로 걸러진 프로필은 자연스럽게 빠진다.
    return ids
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => p != null)
      .map((p) => toCardView(p, { isFavorited: true }));
  });

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-[var(--surface-border)] bg-[var(--surface-page)]/95 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3.5">
          <h1 className="display text-[22px] text-[var(--color-ink-900)]">관심</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pt-4">
        {items.length === 0 ? (
          <Empty
            title="관심 목록이 비어 있어요"
            description="마음이 가는 분의 카드에서 하트를 눌러 담아두세요."
            action={
              <Link
                href="/discover"
                className="text-[13px] text-[var(--color-rose-600)] underline"
              >
                둘러보러 가기
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-6 pb-8 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((profile) => (
              <ProfileCard key={profile.id} profile={profile} from="favorites" />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
