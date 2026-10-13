/**
 * 캡처본 확인 — 유출된 사진에서 누가 본 사진인지 읽는다.
 *
 * 멤버에게 나가는 사진에는 보는 사람 번호가 두 겹으로 들어간다(`server/storage/watermark.ts`).
 * 숨은 층은 맨눈으로 보이지 않으므로 여기서 드러낸다. 판독은 브라우저 안에서만 하고
 * 유출본을 서버로 받지 않는다 — 그래서 이 화면은 DB 를 읽지 않는다.
 */
import { requireAdminPage } from "@/server/auth/guard";
import { Breadcrumb, PageHeader } from "@/components/host/surface";
import { TraceReader } from "@/components/host/trace-reader";

export const dynamic = "force-dynamic";

export default async function TracePage() {
  await requireAdminPage("/profiles/trace");
  return (
    <>
      <Breadcrumb items={[{ label: "멤버", href: "profiles" }, { label: "캡처본 확인" }]} />
      <PageHeader
        title="캡처본 확인"
        description="멤버가 보는 사진에는 보는 사람의 번호가 맨눈에 안 보이게 들어 있습니다. 밖에서 돌아다니는 캡처본을 넣으면 그 번호를 드러냅니다."
      />
      <TraceReader />
    </>
  );
}
