/**
 * 주선자 영역.
 *
 * 볼사람은 주선자를 위한 서비스다 — 이 화면들이 관리 도구가 아니라 제품 본체다.
 * 멤버 화면과 같은 warm ivory 팔레트를 쓰고, 밀도만 한 단 높인다(설계문서 §13에서
 * 벗어난 결정은 `docs/implementation-plan.md` 참고).
 */
import { withRls } from "@bolsaram/db";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { readMyGroupRequests } from "@/server/auth/group-invite";
import { countPendingGroupCreationRequests, readOperatorSettings } from "@/server/auth/operator";
import { unreadByGroup } from "@/server/repo/group-chat";
import { imageUrlFor } from "@/server/views/image-url";
import { HostNav } from "@/components/host/host-nav";
import { HostChatFab } from "@/components/host/chat-fab";
import { ChatStreamProvider } from "@/components/host/chat-stream";
import { PhotoGuard } from "@/components/ui/photo-guard";

export const dynamic = "force-dynamic";

export default async function HostLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireAdminPage();

  // 채팅 배지의 첫 값. 이후에는 SSE 가 밀어준다. 센 시각을 함께 넘겨 화면이 뜨고
  // 연결되기까지의 틈을 스트림이 메우게 한다.
  const countedAt = new Date().toISOString();
  const unread = await withRls(rlsContextOf(viewer), (sql) =>
    unreadByGroup(sql, viewer.userId),
  );

  // 모임 만들기가 승인을 거치는지와 내가 기다리는 요청. 모임 목록 아래 「만들기」와
  // 대기 줄을 그리는 데 쓴다. 관리자에게는 처리할 요청 수를 메뉴 배지로 단다.
  const settings = await readOperatorSettings();
  const groupRequests = await readMyGroupRequests(viewer.userId);
  const operatorPending = viewer.isOperator ? await countPendingGroupCreationRequests() : 0;

  return (
    <div className="host-surface min-h-dvh bg-[var(--surface-page)] text-[var(--surface-text)]">
      <ChatStreamProvider
        initialUnread={Object.fromEntries(unread.map((g) => [g.groupId, g.unread]))}
        since={countedAt}
        viewerId={viewer.userId}
      >
        {/* 사진은 키로 들고 다니다가 그리기 직전에 단기 signed URL 로 바꾼다. */}
        <HostNav
          displayName={viewer.displayName}
          avatarUrl={imageUrlFor(viewer.avatarKey)}
          groups={viewer.groups.map((group) => ({
            id: group.id,
            name: group.name,
            imageUrl: imageUrlFor(group.imageKey),
          }))}
          activeGroupId={viewer.groupId}
          groupRequests={groupRequests.map((request) => ({
            id: request.requestId,
            name: request.name,
            status: request.status,
          }))}
          groupApprovalRequired={settings.groupCreationRequiresApproval && !viewer.isOperator}
          operator={viewer.isOperator ? { pending: operatorPending } : null}
        />
        {/* 좁은 화면에서는 하단 탭이 본문 위에 떠 있다 — 그만큼 바닥을 비운다.
            넓은 화면에는 탭이 없고 사이드바가 왼쪽을 차지한다. */}
        <div className="lg:pl-64">
          <main
            className="mx-auto max-w-6xl px-5 pt-5 lg:pt-7"
            style={{
              paddingBottom:
                "calc(var(--host-tabbar-h) + env(safe-area-inset-bottom) + 1.5rem)",
            }}
          >
            {children}
          </main>
        </div>
        {/* 채팅은 내비게이션 목록이 아니라 어느 화면에서나 같은 자리에 떠 있다.
            누르면 그 자리에 패널로 열린다. */}
        <HostChatFab
          activeGroupId={viewer.groupId}
          groupName={viewer.groups.find((g) => g.id === viewer.groupId)?.name ?? "모임"}
          viewerId={viewer.userId}
        />
      </ChatStreamProvider>
      <PhotoGuard />
    </div>
  );
}
