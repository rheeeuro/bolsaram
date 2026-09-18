/**
 * 모임 설정으로 들어가는 입구.
 *
 * 설정은 모임 하나에 붙어 있으므로(`/group/[id]`) 보고 있는 모임이 있으면 그리로
 * 곧장 보낸다. 전체공개를 보고 있을 때만 여기가 그려진다 — 전체공개는 설정할 것이
 * 없는 공용 방이라, 어느 모임을 고칠지 고르게 한다.
 */
import { redirect } from "next/navigation";
import { requireAdminPage } from "@/server/auth/guard";
import { readMyGroups } from "@/server/auth/group-invite";
import { Empty } from "@/components/ui/empty";
import { PageHeader, Panel } from "@/components/host/surface";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function HostGroupIndexPage() {
  const viewer = await requireAdminPage();
  if (viewer.groupId) redirect(`/group/${viewer.groupId}`);

  const groups = await readMyGroups(viewer.userId);
  if (groups.length === 1) redirect(`/group/${groups[0]!.groupId}`);

  return (
    <>
      <PageHeader
        title="모임 설정"
        description="전체공개는 설정할 것이 없는 공용 방입니다. 고칠 모임을 고르세요."
      />
      {groups.length === 0 ? (
        <Panel>
          <Empty
            title="아직 모임이 없습니다"
            description="왼쪽 모임 목록 아래 「＋ 모임 만들기 · 참여하기」에서 새로 만들거나 초대 코드로 합류하세요. 모임 없이도 전체공개 프로필은 다룰 수 있습니다."
          />
        </Panel>
      ) : (
        <ul className="grid max-w-3xl gap-2">
          {groups.map((group) => (
            <li key={group.groupId}>
              <Link
                href={`/group/${group.groupId}`}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--surface-border)] bg-[var(--surface-card)] px-4 py-3 transition-colors hover:border-[var(--color-rose-300)]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px] text-[var(--surface-text)]">
                    {group.name}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-[var(--surface-text-muted)]">
                    멤버 {group.memberCount}명 · 주선자 {group.admins.length}명
                    {group.isOwner ? " · 내가 모임장" : ""}
                  </span>
                </span>
                <span aria-hidden className="shrink-0 text-[var(--surface-text-muted)]">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
