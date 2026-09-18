/**
 * 모임 채팅방 — 주선자끼리 쓰는 운영 채널 (마이그레이션 0040).
 *
 * 지금 보고 있는 모임의 방 하나를 연다. 방을 고르는 목록을 따로 두지 않는 이유는
 * 상단 전환기가 이미 그 일을 하기 때문이다 — 모임을 바꾸면 이 화면도 그 방이 된다.
 *
 * 전체공개는 모임이 아니라 소속 없음이라 방이 없다.
 */
import Link from "next/link";
import { withRls } from "@bolsaram/db";
import { GROUP_MESSAGE_PAGE_SIZE } from "@bolsaram/schemas";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { listMessages, readPrefs } from "@/server/repo/group-chat";
import { PageHeader } from "@/components/host/surface";
import { Empty } from "@/components/ui/empty";
import { GroupChat } from "@/components/host/group-chat";
import { buttonClasses } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function HostChatPage() {
  const viewer = await requireAdminPage();
  const groupId = viewer.groupId;

  if (!groupId) {
    return (
      <>
        <PageHeader
          title="채팅"
          description="모임 주선자끼리 쓰는 방입니다. 멤버는 들어오지 않습니다."
        />
        <Empty
          title="전체공개에는 채팅방이 없습니다"
          description="모임을 만들거나 동료의 초대 코드로 참여하면 그 모임의 방이 열립니다."
          action={
            <Link href="/group" className={buttonClasses({ size: "sm" })}>
              모임으로 가기
            </Link>
          }
        />
      </>
    );
  }

  const groupName = viewer.groups.find((g) => g.id === groupId)?.name ?? "모임";
  const { messages, prefs } = await withRls(rlsContextOf(viewer), async (sql) => ({
    messages: await listMessages(sql, groupId, { limit: GROUP_MESSAGE_PAGE_SIZE }),
    prefs: await readPrefs(sql, groupId, viewer.userId),
  }));

  return (
    <>
      <PageHeader
        title={groupName}
        kicker="채팅"
        description="이 모임의 주선자만 봅니다. 멤버 이름·연락처는 여기 적지 말고 공개 번호로 부릅니다."
      />
      <GroupChat
        groupId={groupId}
        viewerId={viewer.userId}
        initialMessages={messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))}
        telegramNotify={prefs.telegramNotify}
      />
    </>
  );
}
