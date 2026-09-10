/** Import 검토 — 원본 / AI 결과 / 수정 / commit (설계문서 §6). */
import Link from "next/link";
import { notFound } from "next/navigation";
import { withRls } from "@bolsaram/db";
import { reviewFields } from "@bolsaram/domain";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import {
  effectiveFields,
  latestExtraction,
  listAssets,
  findSession,
} from "@/server/repo/imports";
import { findConversationByImportSession } from "@/server/repo/telegram";
import { signDownloadUrl } from "@/server/storage/local";
import { ImportReview } from "@/components/host/import-review";
import { TELEGRAM_SESSION_STATE_LABELS } from "@bolsaram/schemas";

export const dynamic = "force-dynamic";

export default async function ImportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requireAdminPage();

  const data = await withRls(rlsContextOf(viewer), async (sql) => {
    const session = await findSession(sql, id);
    if (!session) return null;
    const assets = await listAssets(sql, id);
    const extraction = await latestExtraction(sql, id);
    const fields = effectiveFields(extraction);
    const conversation =
      session.source === "TELEGRAM" ? await findConversationByImportSession(sql, id) : null;

    return {
      session: {
        id: session.id,
        status: session.status,
        source: session.source,
        rawText: session.rawText,
        errorMessage: session.errorMessage,
        committedProfileId: session.committedProfileId,
        groupId: session.groupId,
        // 전체공개로 되돌리는 것은 정책상 세션을 만든 사람만 할 수 있다
        // (`import_sessions_admin` 의 WITH CHECK). 화면에서도 같은 판정을 한다.
        canUsePublic: session.createdBy === viewer.userId,
        telegram: conversation
          ? {
              state: TELEGRAM_SESSION_STATE_LABELS[conversation.state],
              startedAt: conversation.createdAt.toISOString(),
              lastActivityAt: conversation.lastActivityAt.toISOString(),
            }
          : null,
      },
      assets: assets.map((asset) => ({
        id: asset.id,
        order: asset.sortOrder,
        filename: asset.originalFilename,
        uploaded: asset.uploadedAt != null,
        url: asset.uploadedAt ? signDownloadUrl(asset.storageKey) : null,
      })),
      extraction: extraction
        ? {
            fields,
            confidence: extraction.confidence,
            notes: extraction.notes,
            model: extraction.model,
            promptVersion: extraction.promptVersion,
            review: reviewFields(fields, extraction.confidence),
          }
        : null,
    };
  });

  if (!data) notFound();

  return (
    <>
      <nav className="mb-5 text-[12.5px] text-[var(--surface-text-muted)]">
        <Link href="/imports" className="hover:text-[var(--color-rose-600)]">
          가져오기
        </Link>
        <span className="mx-2">·</span>
        <span className="text-[var(--surface-text)]">검토</span>
      </nav>

      <ImportReview
        session={data.session}
        assets={data.assets}
        extraction={data.extraction}
        groups={viewer.groups}
      />
    </>
  );
}
