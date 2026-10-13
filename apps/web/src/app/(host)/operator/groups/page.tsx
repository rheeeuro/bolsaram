/**
 * 관리자 메뉴 › 모임 설정 — 모임 만들기 승인·초대 코드 여러 번 쓰기 켜기·끄기와
 * 들어온 요청 처리.
 */
import { requireOperatorPage } from "@/server/auth/guard";
import { listGroupCreationRequests, readOperatorSettings } from "@/server/auth/operator";
import { Breadcrumb, PageHeader } from "@/components/host/surface";
import {
  GroupApprovalPanel,
  GroupInviteReusePanel,
  GroupRequestHistory,
  GroupRequestQueue,
  type OperatorGroupRequest,
} from "@/components/host/operator-settings";
import type { GroupCreationRequestRow } from "@/server/auth/operator";

export const dynamic = "force-dynamic";

function serialize(row: GroupCreationRequestRow): OperatorGroupRequest {
  return {
    requestId: row.requestId,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    requester: {
      displayName: row.requester.displayName,
      email: row.requester.email,
      groupCount: row.requester.groupCount,
    },
  };
}

export default async function OperatorGroupsPage() {
  await requireOperatorPage("/operator/groups");
  const settings = await readOperatorSettings();
  const { pending, recent } = await listGroupCreationRequests();

  return (
    <>
      <Breadcrumb items={[{ label: "관리자 메뉴", href: "/operator" }, { label: "모임 설정" }]} />
      <PageHeader
        kicker="관리자"
        title="모임 설정"
        description="주선자가 모임을 만드는 방식과 동료를 들이는 초대 코드의 쓰임을 정합니다."
      />
      <div className="grid max-w-3xl gap-4">
        <GroupApprovalPanel
          enabled={settings.groupCreationRequiresApproval}
          pendingCount={pending.length}
        />
        <GroupInviteReusePanel enabled={settings.groupInviteReusable} />
        <GroupRequestQueue pending={pending.map(serialize)} />
        <GroupRequestHistory recent={recent.map(serialize)} />
      </div>
    </>
  );
}
