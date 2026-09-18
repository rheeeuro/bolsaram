/**
 * 프로필 내용 편집 — 등록한 주선자만.
 *
 * 담당이 아니면 상세로 돌려보낸다. 고칠 수 없는 폼을 보여주면 저장을 눌러야
 * 막힌 것을 안다(0011).
 */
import { notFound, redirect } from "next/navigation";
import { requireAdminPage } from "@/server/auth/guard";
import { loadHostProfile } from "@/server/views/host-profile";
import { Breadcrumb } from "@/components/host/surface";
import { HostProfileEditor } from "@/components/host/profile-editor";

export const dynamic = "force-dynamic";

export default async function HostProfileEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requireAdminPage();
  const data = await loadHostProfile(viewer, id);
  if (!data) notFound();
  if (!data.canEdit) redirect(`/profiles/${id}`);

  return (
    <>
      <Breadcrumb
        items={[
          { label: "프로필", href: "/profiles" },
          { code: data.view.code, href: `/profiles/${id}` },
          { label: "내용 고치기" },
        ]}
      />
      <HostProfileEditor profile={data.view} />
    </>
  );
}

export function generateMetadata() {
  return { title: "프로필 고치기 · 볼사람", robots: { index: false, follow: false } };
}
