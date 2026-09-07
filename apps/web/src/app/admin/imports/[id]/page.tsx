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
import { signDownloadUrl } from "@/server/storage/local";
import { ImportReview } from "@/components/admin/import-review";

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

    return {
      session: {
        id: session.id,
        status: session.status,
        source: session.source,
        rawText: session.rawText,
        errorMessage: session.errorMessage,
        committedProfileId: session.committedProfileId,
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
      <nav className="mb-4 text-[12.5px] text-[var(--surface-text-muted)]">
        <Link href="/admin/imports" className="underline">
          Import Inbox
        </Link>
        <span className="mx-1.5">/</span>
        <span>검토</span>
      </nav>

      <ImportReview session={data.session} assets={data.assets} extraction={data.extraction} />
    </>
  );
}
