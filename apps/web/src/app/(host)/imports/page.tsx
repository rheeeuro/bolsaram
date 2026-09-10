/**
 * 가져오기 (설계문서 §6, 설계 변경 문서 TELEGRAM v1 §13).
 * 카카오톡에서 받은 사진과 글을 여기서 세션으로 만든다.
 * 텔레그램 봇으로 들어온 것도 같은 목록에 올라오며, 출처를 함께 보여준다.
 */
import { withRls } from "@bolsaram/db";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { Blank, Count, PageHeader, Panel, Row, RowList } from "@/components/host/surface";
import { listInbox } from "@/server/repo/imports";
import { findConnectionForUser } from "@/server/repo/telegram";
import { isTelegramEnabled } from "@/server/env";
import { label } from "@/lib/labels";
import { NewImportPanel } from "@/components/host/new-import-panel";
import { TelegramLinkPanel } from "@/components/host/telegram-link-panel";

export const dynamic = "force-dynamic";

export default async function ImportInboxPage() {
  const viewer = await requireAdminPage();
  const { items, connection } = await withRls(rlsContextOf(viewer), async (sql) => ({
    items: await listInbox(sql, { groupId: viewer.groupId }),
    connection: await findConnectionForUser(sql, viewer.userId),
  }));

  return (
    <>
      <PageHeader
        title="가져오기"
        description="카카오톡에서 받은 사진과 글을 올리면 AI가 프로필 항목을 채웁니다. 공개는 언제나 주선자가 검토한 뒤에만 이루어집니다."
      />

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <div className="flex flex-col gap-5">
          <NewImportPanel />
          <TelegramLinkPanel
            enabled={isTelegramEnabled()}
            connected={connection != null}
            lastSeenAt={connection?.lastSeenAt?.toISOString() ?? null}
          />
        </div>

        <Panel
          title="가져온 것"
          action={<Count>{items.length}건</Count>}
          className="overflow-hidden self-start"
        >
          {items.length === 0 ? (
            <Blank>아직 가져온 프로필이 없습니다.</Blank>
          ) : (
            <div className="-mx-5 -my-5">
              <RowList>
                {items.map((item) => (
                  <Row key={item.id} href={`/imports/${item.id}`} className="items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={toneForStatus(item.status)}>
                          {label.importStatus(item.status)}
                        </Badge>
                        <span className="text-[12.5px] text-[var(--surface-text-muted)]">
                          {label.importSource(item.source)} · 사진 {item.assetCount}장
                        </span>
                      </div>
                      <p className="mt-1.5 truncate text-[13px] text-[var(--surface-text)]">
                        {item.rawText?.replace(/\n/g, " ").slice(0, 70) ?? "글 없음"}
                      </p>
                      {item.errorMessage ? (
                        <p className="mt-1 text-[12px] text-[var(--color-danger)]">
                          {item.errorMessage}
                        </p>
                      ) : null}
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-[12px] text-[var(--surface-text-muted)]">
                        {item.createdAt.toLocaleString("ko-KR", {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                      <p className="mt-1 text-[12.5px] text-[var(--color-rose-600)]">
                        {item.status === "IMPORTED" ? "보기" : "검토하기"}
                      </p>
                    </div>
                  </Row>
                ))}
              </RowList>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
