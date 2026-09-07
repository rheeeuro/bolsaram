/**
 * 관리자 영역. 회원 화면의 감성 톤과 분리해 Linear/Notion 계열의 CRM 밀도로 만든다
 * (설계문서 §13).
 */
import { requireAdminPage } from "@/server/auth/guard";
import { AdminNav } from "@/components/admin/admin-nav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireAdminPage();

  return (
    <div className="admin-surface min-h-dvh bg-[var(--surface-page)] text-[var(--surface-text)]">
      <AdminNav displayName={viewer.displayName} />
      <div className="mx-auto max-w-7xl px-5 py-6">{children}</div>
    </div>
  );
}
