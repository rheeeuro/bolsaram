/**
 * 프로필 상세 — 누가 등록했든 같은 읽기 화면.
 *
 * 담당이면 여기에 운영 액션(공개 여부·초대·대행)이 함께 붙고, 내용을 고치는 일은
 * `/profiles/[id]/edit` 으로 나간다.
 */
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/server/auth/guard";
import { loadHostProfile } from "@/server/views/host-profile";
import { Breadcrumb } from "@/components/host/surface";
import { HostProfileDetail } from "@/components/host/profile-detail";

export const dynamic = "force-dynamic";

export default async function HostProfileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requireAdminPage();
  const data = await loadHostProfile(viewer, id);
  if (!data) notFound();

  return (
    <>
      <Breadcrumb items={[{ label: "프로필", href: "/profiles" }, { code: data.view.code }]} />
      <HostProfileDetail
        profile={data.view}
        canEdit={data.canEdit}
        status={data.status}
        visibility={data.visibility}
        claimed={data.claimed}
        invite={data.invite}
      />
    </>
  );
}

export function generateMetadata() {
  // 상세 페이지는 개인정보를 담으므로 제목에 아무 것도 흘리지 않는다.
  return { title: "프로필 · 볼사람", robots: { index: false, follow: false } };
}
