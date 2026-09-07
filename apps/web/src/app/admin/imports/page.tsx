/**
 * Import Inbox (설계문서 §6, 설계 변경 문서 TELEGRAM v1 §13).
 * 카카오톡에서 받은 사진과 글을 여기서 세션으로 만든다.
 * 텔레그램 봇으로 들어온 것도 같은 목록에 올라오며, 출처 열로 구분한다.
 */
import Link from "next/link";
import { withRls } from "@bolsaram/db";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/admin/table";
import { listInbox } from "@/server/repo/imports";
import { findConnectionForUser } from "@/server/repo/telegram";
import { isTelegramEnabled } from "@/server/env";
import { label } from "@/lib/labels";
import { NewImportPanel } from "@/components/admin/new-import-panel";
import { TelegramLinkPanel } from "@/components/admin/telegram-link-panel";

export const dynamic = "force-dynamic";

export default async function ImportInboxPage() {
  const viewer = await requireAdminPage();
  const { items, connection } = await withRls(rlsContextOf(viewer), async (sql) => ({
    items: await listInbox(sql, {}),
    connection: await findConnectionForUser(sql, viewer.userId),
  }));

  return (
    <>
      <header className="mb-4">
        <h1 className="text-[18px] font-semibold tracking-tight">Import Inbox</h1>
        <p className="mt-1 text-[12.5px] text-[var(--surface-text-muted)]">
          카카오톡에서 받은 사진과 글을 올리면 AI가 프로필 항목을 채웁니다. 게시는 검토 후에만
          이루어집니다.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <NewImportPanel />
          <TelegramLinkPanel
            enabled={isTelegramEnabled()}
            connected={connection != null}
            lastSeenAt={connection?.lastSeenAt?.toISOString() ?? null}
          />
        </div>

        <section>
          {items.length === 0 ? (
            <p className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)] py-12 text-center text-[13px] text-[var(--surface-text-muted)]">
              아직 가져온 프로필이 없습니다.
            </p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>상태</Th>
                  <Th>출처</Th>
                  <Th>사진</Th>
                  <Th>원문</Th>
                  <Th>생성</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-[var(--surface-muted)]">
                    <Td>
                      <Badge tone={toneForStatus(item.status)}>
                        {label.importStatus(item.status)}
                      </Badge>
                      {item.errorMessage ? (
                        <p className="mt-1 max-w-48 text-[11.5px] text-[var(--color-danger)]">
                          {item.errorMessage}
                        </p>
                      ) : null}
                    </Td>
                    <Td className="text-[12.5px]">{label.importSource(item.source)}</Td>
                    <Td className="text-[12.5px]">{item.assetCount}장</Td>
                    <Td className="max-w-64 truncate text-[12.5px] text-[var(--surface-text-muted)]">
                      {item.rawText?.replace(/\n/g, " ").slice(0, 60) ?? "—"}
                    </Td>
                    <Td className="whitespace-nowrap text-[12.5px] text-[var(--surface-text-muted)]">
                      {item.createdAt.toLocaleString("ko-KR", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Td>
                    <Td>
                      <Link
                        href={`/admin/imports/${item.id}`}
                        className="text-[12.5px] text-[var(--surface-accent)] underline"
                      >
                        {item.status === "IMPORTED" ? "보기" : "검토"}
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>
      </div>
    </>
  );
}
