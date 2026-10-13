/**
 * 관리자 메뉴 › 주선자 — 가입한 주선자 목록과 정지.
 */
import { requireOperatorPage } from "@/server/auth/guard";
import { listHosts, type HostRow } from "@/server/auth/operator";
import { Breadcrumb, PageHeader } from "@/components/host/surface";
import { HostList, type OperatorHost } from "@/components/host/operator-hosts";

export const dynamic = "force-dynamic";

function serialize(row: HostRow): OperatorHost {
  return {
    userId: row.userId,
    displayName: row.displayName,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    isOperator: row.isOperator,
    groups: row.groups,
    activeProfiles: row.activeProfiles,
    totalProfiles: row.totalProfiles,
    telegramConnected: row.telegramConnected,
    suspension: row.suspension
      ? {
          at: row.suspension.at.toISOString(),
          reason: row.suspension.reason,
          byName: row.suspension.byName,
        }
      : null,
  };
}

export default async function OperatorHostsPage() {
  await requireOperatorPage("/operator/hosts");
  const hosts = await listHosts();

  return (
    <>
      <Breadcrumb items={[{ label: "관리자 메뉴", href: "/operator" }, { label: "주선자" }]} />
      <PageHeader
        kicker="관리자"
        title="주선자"
        description="가입한 주선자를 보고, 문제가 있는 계정을 정지합니다."
      />
      <div className="grid max-w-3xl gap-4">
        <HostList hosts={hosts.map(serialize)} />
      </div>
    </>
  );
}
