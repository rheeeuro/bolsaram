/**
 * 모임 설정 — 이름·주선자·알림·폐쇄.
 *
 * 모임 **안에** 있는 화면이다. 사이드바에서 그 모임을 고른 채로 이름 옆 메뉴를 통해
 * 들어온다. 속하지 않은 모임이면 404 다 — 다른 모임의 설정은 주소를 알아도 열리지
 * 않는다(`readMyGroups` 가 내 소속만 준다).
 *
 * 들어오면 보고 있는 모임도 이 모임으로 맞춘다. 설정만 열어 두고 아래 화면들은
 * 다른 모임을 보고 있으면 어디를 고치고 있는지 헷갈린다.
 */
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/server/auth/guard";
import { readMyGroups, setActiveGroup } from "@/server/auth/group-invite";
import { PageHeader } from "@/components/host/surface";
import { GroupSettings } from "@/components/host/group-settings";

export const dynamic = "force-dynamic";

export default async function HostGroupSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requireAdminPage();

  const group = (await readMyGroups(viewer.userId)).find((g) => g.groupId === id);
  if (!group) notFound();

  if (viewer.groupId !== group.groupId) {
    await setActiveGroup(viewer.userId, group.groupId);
  }

  return (
    <>
      <PageHeader
        kicker={group.name}
        title="모임 설정"
        description="이 모임에만 적용됩니다. 다른 모임을 고치려면 그 모임으로 옮겨 간 뒤 여기로 옵니다."
      />
      <GroupSettings group={group} viewerUserId={viewer.userId} />
    </>
  );
}
