/**
 * 모임 설정 — 정보 수정 · 주선자 구성원 · 초대 코드.
 *
 * 모임이 없는 상태도 정상이다(가입 직후). 그때는 만들기·참여를 보여준다.
 */
import { requireAdminPage } from "@/server/auth/guard";
import { readMyGroup } from "@/server/auth/group-invite";
import { GroupSettings } from "@/components/admin/group-settings";

export const dynamic = "force-dynamic";

export default async function AdminGroupPage() {
  const viewer = await requireAdminPage();
  const group = await readMyGroup(viewer.userId);

  return (
    <>
      <header className="mb-4">
        <h1 className="text-[18px] font-semibold tracking-tight">모임</h1>
        <p className="mt-1 text-[12.5px] text-[var(--surface-text-muted)]">
          {group
            ? "모임에 등록한 회원은 같은 모임 주선자만 봅니다. 전체공개로 등록한 회원은 모든 주선자가 봅니다."
            : "아직 모임이 없습니다. 모임 없이도 전체공개 프로필은 다룰 수 있습니다."}
        </p>
      </header>
      <GroupSettings group={group} />
    </>
  );
}
