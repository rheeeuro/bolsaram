/**
 * 관리자 메뉴.
 *
 * 볼사람 전체에 걸리는 설정을 모은 곳이다. `SEED_ADMIN_EMAIL1` 의 주선자 계정만
 * 들어오고, 다른 주선자는 홈으로 돌아간다. 모임 안의 화면이 아니라서 사이드바의
 * 화면 목록에 넣지 않고 아래쪽 「관리자 메뉴」로 들어온다.
 */
import Link from "next/link";
import { requireOperatorPage } from "@/server/auth/guard";
import { countPendingGroupCreationRequests, readOperatorSettings } from "@/server/auth/operator";
import { PageHeader } from "@/components/host/surface";

export const dynamic = "force-dynamic";

export default async function OperatorPage() {
  await requireOperatorPage("/operator");
  const settings = await readOperatorSettings();
  const pending = await countPendingGroupCreationRequests();

  const items = [
    {
      href: "/operator/groups",
      title: "모임 설정",
      description: settings.groupCreationRequiresApproval
        ? "모임 만들기 승인 켜짐 — 주선자가 만든 모임은 승인해야 생깁니다."
        : "모임 만들기 승인 꺼짐 — 주선자가 바로 모임을 만듭니다.",
      count: pending,
    },
  ];

  return (
    <>
      <PageHeader
        kicker="관리자"
        title="관리자 메뉴"
        description="볼사람 전체에 적용되는 설정입니다. 관리자 계정에만 보입니다."
      />
      <ul className="grid max-w-3xl gap-3">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="flex items-center gap-4 rounded-[var(--radius-card)] border border-[var(--surface-border)] bg-[var(--surface-card)] px-5 py-4 shadow-[var(--shadow-card)] transition-colors hover:border-[var(--color-rose-300)]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">{item.title}</span>
                <span className="mt-1 block text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
                  {item.description}
                </span>
              </span>
              {item.count > 0 ? (
                <span className="shrink-0 rounded-full bg-[var(--color-rose-600)] px-2 py-0.5 text-[12px] text-white">
                  대기 {item.count}
                </span>
              ) : null}
              <span aria-hidden className="shrink-0 text-[var(--surface-text-muted)]">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
