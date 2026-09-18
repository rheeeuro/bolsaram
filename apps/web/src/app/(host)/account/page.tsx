/**
 * 계정 설정 — 내 이름 · 로그인 방식 · 텔레그램 연결 · 로그아웃.
 *
 * **모임 밖에 있는 화면이다.** 여기서 고치는 것은 보고 있는 모임과 무관하게 내 계정
 * 하나에만 적용된다 — 모임을 다루는 것은 `/group/[id]` 다. 그래서 사이드바의 모임
 * 목록 아래 화면 목록에 넣지 않고, 이름(「○○ 님」)을 눌러 들어온다.
 *
 * 텔레그램 연결도 계정에 붙는 것이라 여기 있다. 봇으로 보낸 프로필이 어느 모임에
 * 담기는지는 연결마다 하나씩 정해지고(`telegram_connections.upload_group_id`),
 * 화면 위쪽에서 보고 있는 모임과는 별개다.
 */
import { withRls } from "@bolsaram/db";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { listLinkedOAuthAccounts } from "@/server/auth/oauth";
import { enabledOAuthProviders, isTelegramEnabled } from "@/server/env";
import { findConnectionForUser } from "@/server/repo/telegram";
import { PageHeader } from "@/components/host/surface";
import {
  AccountNamePanel,
  LoginMethodsPanel,
  SessionPanel,
} from "@/components/host/account-settings";
import { TelegramLinkPanel } from "@/components/host/telegram-link-panel";

export const dynamic = "force-dynamic";

export default async function HostAccountPage() {
  const viewer = await requireAdminPage("/account");

  const connection = await withRls(rlsContextOf(viewer), (sql) =>
    findConnectionForUser(sql, viewer.userId),
  );
  const methods = await listLinkedOAuthAccounts(viewer.userId);

  return (
    <>
      <PageHeader
        kicker="내 계정"
        title="계정 설정"
        description="보고 있는 모임과 무관하게 내 계정에만 적용됩니다. 모임을 고치려면 모임 이름을 눌러 「모임 설정」으로 갑니다."
      />

      <div className="grid max-w-3xl gap-4">
        <AccountNamePanel displayName={viewer.displayName} />

        <LoginMethodsPanel
          methods={methods.map((method) => ({
            provider: method.provider,
            email: method.email,
            linkedAt: method.linkedAt.toISOString(),
            lastLoginAt: method.lastLoginAt?.toISOString() ?? null,
          }))}
          available={enabledOAuthProviders()}
        />

        <TelegramLinkPanel
          enabled={isTelegramEnabled()}
          connected={connection != null}
          lastSeenAt={connection?.lastSeenAt?.toISOString() ?? null}
          groups={viewer.groups}
          uploadGroupId={connection?.uploadGroupId ?? null}
        />

        <SessionPanel />
      </div>
    </>
  );
}
