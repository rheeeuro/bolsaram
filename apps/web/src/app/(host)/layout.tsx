/**
 * 주선자 영역.
 *
 * 볼사람은 주선자를 위한 서비스다 — 이 화면들이 관리 도구가 아니라 제품 본체다.
 * 멤버 화면과 같은 warm ivory 팔레트를 쓰고, 밀도만 한 단 높인다(설계문서 §13에서
 * 벗어난 결정은 `docs/implementation-plan.md` 참고).
 */
import { withRls } from "@bolsaram/db";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { unreadByGroup } from "@/server/repo/group-chat";
import { HostNav } from "@/components/host/host-nav";
import { ChatStreamProvider } from "@/components/host/chat-stream";

export const dynamic = "force-dynamic";

export default async function HostLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireAdminPage();

  // 채팅 배지의 첫 값. 이후에는 SSE 가 밀어준다. 센 시각을 함께 넘겨 화면이 뜨고
  // 연결되기까지의 틈을 스트림이 메우게 한다.
  const countedAt = new Date().toISOString();
  const unread = await withRls(rlsContextOf(viewer), (sql) =>
    unreadByGroup(sql, viewer.userId),
  );

  return (
    <div className="host-surface min-h-dvh bg-[var(--surface-page)] text-[var(--surface-text)]">
      <ChatStreamProvider
        initialUnread={Object.fromEntries(unread.map((g) => [g.groupId, g.unread]))}
        since={countedAt}
        viewerId={viewer.userId}
      >
        <HostNav
          displayName={viewer.displayName}
          groups={viewer.groups}
          activeGroupId={viewer.groupId}
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
      </ChatStreamProvider>
    </div>
  );
}
