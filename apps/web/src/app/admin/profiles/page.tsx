/** 프로필 목록 — 검색/필터/상태 관리 (설계문서 §6). */
import Link from "next/link";
import { withRls } from "@bolsaram/db";
import { adminProfileQuerySchema, PROFILE_STATUSES, type ConsentMethod } from "@bolsaram/schemas";
import { needsConsentReview } from "@bolsaram/domain";
import { requireAdminPage, rlsContextOf } from "@/server/auth/guard";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/admin/table";
import { findAdminProfiles } from "@/server/repo/profiles";
import { toDetailView } from "@/server/views/profile-view";
import { label } from "@/lib/labels";
import { AdminProfileFilters } from "@/components/admin/profile-filters";

export const dynamic = "force-dynamic";

export default async function AdminProfilesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminPage();
  const raw = await searchParams;
  // 잘못된 쿼리로 화면이 죽지 않도록 기본값으로 떨어뜨린다.
  const parsed = adminProfileQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : adminProfileQuerySchema.parse({});

  const page = await withRls(rlsContextOf(viewer), async (sql) => {
    const result = await findAdminProfiles(sql, query);
    return {
      total: result.total,
      items: result.items.map((profile) => ({
        view: toDetailView(profile, "ADMIN"),
        claimed: profile.userId != null,
        createdAt: profile.createdAt.toISOString(),
      })),
    };
  });

  return (
    <>
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="text-[18px] font-semibold tracking-tight">프로필</h1>
        <span className="text-[12.5px] text-[var(--surface-text-muted)]">{page.total}건</span>
      </header>

      <AdminProfileFilters statuses={[...PROFILE_STATUSES]} />

      <div className="mt-4">
        {page.items.length === 0 ? (
          <p className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)] py-12 text-center text-[13px] text-[var(--surface-text-muted)]">
            조건에 맞는 프로필이 없습니다.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>코드</Th>
                <Th>사진</Th>
                <Th>기본</Th>
                <Th>직업</Th>
                <Th>지역</Th>
                <Th>상태</Th>
                <Th>계정</Th>
                <Th>등록일</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {page.items.map(({ view, claimed, createdAt }) => (
                <tr key={view.id} className="hover:bg-[var(--surface-muted)]">
                  <Td className="font-medium">{view.code}</Td>
                  <Td>
                    <div className="h-10 w-8 overflow-hidden rounded bg-[var(--surface-muted)]">
                      {view.primaryImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={view.primaryImage.url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                  </Td>
                  <Td>
                    {label.gender(view.gender)} · {view.birthYear}
                    {view.height ? ` · ${view.height}cm` : ""}
                  </Td>
                  <Td className="max-w-40 truncate">
                    {[view.jobTitle, label.jobCategory(view.jobCategory)]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </Td>
                  <Td>{label.region(view.residenceRegion)}</Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={toneForStatus(view.status ?? "")}>
                        {label.profileStatus(view.status)}
                      </Badge>
                      <span className="text-[11.5px] text-[var(--surface-text-muted)]">
                        {label.visibility(view.visibility)}
                      </span>
                      {needsConsentReview({
                        method: (view.consent?.method ?? null) as ConsentMethod | null,
                        confirmedAt: null,
                      }) ? (
                        <Badge tone="warning">동의 확인 필요</Badge>
                      ) : null}
                    </div>
                  </Td>
                  <Td>
                    {claimed ? (
                      <Badge tone="active">연결됨</Badge>
                    ) : (
                      <Badge tone="neutral">미연결</Badge>
                    )}
                  </Td>
                  <Td className="text-[var(--surface-text-muted)]">
                    {new Date(createdAt).toLocaleDateString("ko-KR")}
                  </Td>
                  <Td>
                    <Link
                      href={`/admin/profiles/${view.id}`}
                      className="text-[12.5px] text-[var(--surface-accent)] underline"
                    >
                      관리
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}
