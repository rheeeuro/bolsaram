/**
 * 모임 — 속한 모임 전부의 설정 · 주선자 구성원 · 초대 코드.
 *
 * 모임이 하나도 없는 상태도 정상이다(가입 직후). 그때는 전체공개 채널만 쓴다.
 */
import { requireAdminPage } from "@/server/auth/guard";
import { readMyGroups } from "@/server/auth/group-invite";
import { PageHeader } from "@/components/host/surface";
import { GroupSettings } from "@/components/host/group-settings";

export const dynamic = "force-dynamic";

export default async function HostGroupPage() {
  const viewer = await requireAdminPage();
  const groups = await readMyGroups(viewer.userId);

  return (
    <>
      <PageHeader
        title="모임"
        description={
          groups.length > 0
            ? "지금 고를 수 있는 방입니다. 모임에 등록한 회원은 같은 모임 주선자만 봅니다 — 카드의 「설정」에서 이름·동료 초대·나가기를 다룹니다."
            : "아직 모임이 없습니다. 모임 없이도 전체공개 프로필은 다룰 수 있습니다."
        }
      />
      <GroupSettings groups={groups} activeGroupId={viewer.groupId} />
    </>
  );
}
