/**
 * 가져오기 (설계문서 §6, 설계 변경 문서 TELEGRAM v1 §13).
 * 카카오톡에서 받은 사진과 글을 여기서 세션으로 만든다.
 * 텔레그램 봇으로 들어온 것도 같은 목록에 올라오며, 출처를 함께 보여준다.
 *
 * 목록은 **검토 대기**와 **등록됨** 두 칸이다. 끝난 건이 쌓여 할 일을 묻지 않게 한다.
 * 등록을 마치면 이 화면으로 돌아와 위쪽에 결과를 알리고, 옆의 올리기 칸에서 다음
 * 사람을 바로 이어 올린다 — 카카오톡방에 쌓인 여러 명을 차례로 옮기는 흐름이다.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { withRls } from "@bolsaram/db";
import type { ExtractedFields } from "@bolsaram/schemas";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Blank, PageHeader, Panel, Row, RowList } from "@/components/host/surface";
import { countInbox, listInbox, type InboxItem } from "@/server/repo/imports";
import { findProfileById } from "@/server/repo/profiles";
import { findConnectionForUser } from "@/server/repo/telegram";
import { isTelegramEnabled } from "@/server/env";
import { label } from "@/lib/labels";
import { cn } from "@/lib/cn";
import { NewImportPanel } from "@/components/host/new-import-panel";
import { TelegramImportNote } from "@/components/host/telegram-import-note";

export const dynamic = "force-dynamic";

export default async function ImportInboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminPage();
  const raw = await searchParams;
  const done = raw.tab === "done";
  const registeredId = typeof raw.registered === "string" ? raw.registered : null;

  const { items, counts, connection, registered } = await withRls(
    rlsContextOf(viewer),
    async (sql) => ({
      items: await listInbox(sql, { groupId: viewer.groupId, done }),
      counts: await countInbox(sql, viewer.groupId),
      connection: await findConnectionForUser(sql, viewer.userId),
      // 방금 등록한 프로필. 주소로 들어온 값이라 RLS 로 다시 읽어 볼 수 있을 때만 알린다.
      registered: registeredId && isUuid(registeredId)
        ? await findProfileById(sql, registeredId)
        : null,
    }),
  );

  return (
    <>
      <PageHeader
        title="가져오기"
        description="카카오톡에서 받은 사진과 글을 올리면 AI가 프로필 항목을 채웁니다. 공개는 언제나 주선자가 검토한 뒤에만 이루어집니다."
      />

      {registered ? (
        <div
          role="status"
          className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[var(--radius-card)] border border-[var(--color-success)]/30 bg-[var(--color-success)]/8 px-4 py-3"
        >
          <p className="min-w-0 flex-1 text-[13px] text-[var(--surface-text)]">
            <b>{registered.publicCode}번</b>으로 등록했습니다
            {registered.status === "ACTIVE" ? " · 멤버에게 보입니다" : " · 아직 비공개입니다"}.
            <span className="text-[var(--surface-text-muted)]"> 다음 분을 이어서 올리세요.</span>
          </p>
          <Link
            href={`/profiles/${registered.id}`}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            프로필 · 초대 링크
          </Link>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <div className="flex flex-col gap-5">
          <NewImportPanel groups={viewer.groups} activeGroupId={viewer.groupId} />
          {/* 봇 연결 자체는 계정 설정에 있다 — 여기서는 상태만 알린다. */}
          {isTelegramEnabled() ? (
            <TelegramImportNote
              connected={connection != null}
              uploadGroupName={
                viewer.groups.find((group) => group.id === connection?.uploadGroupId)?.name ??
                "전체공개"
              }
            />
          ) : null}
        </div>

        <Panel className="overflow-hidden self-start">
          <nav
            aria-label="가져오기 목록"
            className="-mx-5 -mt-5 mb-5 flex items-center gap-1.5 border-b border-[var(--surface-border)] px-5 py-3"
          >
            <InboxTab href="/imports" active={!done} count={counts.pending}>
              검토 대기
            </InboxTab>
            <InboxTab href="/imports?tab=done" active={done} count={counts.done}>
              등록됨
            </InboxTab>
          </nav>
          {items.length === 0 ? (
            <Blank>
              {done
                ? "아직 등록한 프로필이 없습니다."
                : "검토할 것이 없습니다. 카카오톡에서 받은 프로필을 올리면 여기에 쌓입니다."}
            </Blank>
          ) : (
            <div className="-mx-5 -mb-5 -mt-5">
              <RowList>
                {items.map((item) => (
                  <InboxRow key={item.id} item={item} />
                ))}
              </RowList>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function InboxRow({ item }: { item: InboxItem }) {
  const summary = summaryLine(item.summary);
  const registered = item.status === "IMPORTED" && item.committedProfileId != null;
  // 등록된 사람은 이제 프로필에서 다룬다. 원본은 거기서도 「원본」 보기로 볼 수 있다.
  const href = registered ? `/profiles/${item.committedProfileId}` : `/imports/${item.id}`;
  const when = (registered ? item.committedAt : null) ?? item.createdAt;

  return (
    <Row href={href} className="items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {registered && item.profileCode != null ? (
            <span className="text-[13px] font-medium text-[var(--surface-text)]">
              {item.profileCode}번
            </span>
          ) : (
            <Badge tone={toneForStatus(item.status)}>{label.importStatus(item.status)}</Badge>
          )}
          <span className="text-[12.5px] text-[var(--surface-text-muted)]">
            {label.importSource(item.source)} · 사진 {item.assetCount}장
          </span>
        </div>
        {/* 분석이 끝났으면 사람을 알아볼 요약을, 아니면 받은 글의 앞부분을 보여준다. */}
        <p className="mt-1.5 truncate text-[13px] text-[var(--surface-text)]">
          {summary ?? item.rawText?.replace(/\n/g, " ").slice(0, 70) ?? "글 없음"}
        </p>
        {item.errorMessage ? (
          <p className="mt-1 text-[12px] text-[var(--color-danger)]">{item.errorMessage}</p>
        ) : null}
      </div>

      <div className="shrink-0 text-right">
        <p className="text-[12px] text-[var(--surface-text-muted)]">
          {when.toLocaleString("ko-KR", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
        <p className="mt-1 text-[12.5px] text-[var(--color-rose-600)]">
          {registered ? "프로필" : "검토하기"}
        </p>
      </div>
    </Row>
  );
}

/** 「여성 · 97년생 · 163cm · 병원 전문의」. 알아볼 값이 하나도 없으면 null. */
function summaryLine(fields: Partial<ExtractedFields> | null): string | null {
  if (!fields) return null;
  const parts = [
    fields.gender ? label.gender(fields.gender) : null,
    label.birthYear(fields.birthYear),
    fields.height ? `${fields.height}cm` : null,
    fields.jobTitle ?? (fields.jobCategory ? label.jobCategory(fields.jobCategory) : null),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** 목록 칸 전환. 프로필 목록의 보기 전환과 같은 알약 모양이다. */
function InboxTab({
  href,
  active,
  count,
  children,
}: {
  href: string;
  active: boolean;
  count: number;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 py-1 text-[13px]",
        "transition-colors duration-[var(--duration-quick)]",
        active
          ? "border-[var(--color-rose-600)] bg-[var(--color-rose-600)] text-white"
          : "border-[var(--surface-border)] bg-[var(--surface-card)] text-[var(--surface-text-muted)] hover:border-[var(--color-rose-300)]",
      )}
    >
      {children}
      <span className={cn("text-[12px]", active ? "text-white/80" : "")}>{count}</span>
    </Link>
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
