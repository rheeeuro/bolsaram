/** 프로필 상세 관리 — 상태 전환, 필드 수정, 초대 발급. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { withRls } from "@bolsaram/db";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { findProfileById } from "@/server/repo/profiles";
import { toDetailView } from "@/server/views/profile-view";
import { HostProfileEditor } from "@/components/host/profile-editor";

export const dynamic = "force-dynamic";

export default async function HostProfileDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requireAdminPage();

  const data = await withRls(rlsContextOf(viewer), async (sql) => {
    const profile = await findProfileById(sql, id);
    if (!profile) return null;

    const invite = await sql.query<{ expires_at: Date; claimed_at: Date | null }>(
      `SELECT expires_at, claimed_at FROM invites
        WHERE profile_id = $1 AND revoked_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [id],
    );

    return {
      view: toDetailView(profile, "ADMIN"),
      claimed: profile.userId != null,
      invite: invite.rows[0]
        ? {
            expiresAt: invite.rows[0].expires_at.toISOString(),
            claimed: invite.rows[0].claimed_at != null,
          }
        : null,
    };
  });

  if (!data) notFound();

  return (
    <>
      <nav className="mb-5 text-[12.5px] text-[var(--surface-text-muted)]">
        <Link href="/profiles" className="hover:text-[var(--color-rose-600)]">
          프로필
        </Link>
        <span className="mx-2">·</span>
        <span className="display text-[13px] text-[var(--surface-text)]">{data.view.code}</span>
      </nav>

      <HostProfileEditor profile={data.view} claimed={data.claimed} invite={data.invite} />
    </>
  );
}
