"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { LoadMore } from "@/components/ui/load-more";
import { ProfileCode } from "@/components/ui/marks";
import { apiGet } from "@/lib/api-client";
import { formatDay } from "@/lib/dates";
import { label } from "@/lib/labels";
import { cn } from "@/lib/cn";
import type { HostProfileCardItem, HostProfilePage } from "@/server/views/host-profile-list";
import { ProfileRawList, type RawListItem } from "./profile-raw-list";

type Initial =
  | { mode: "card"; items: HostProfileCardItem[]; nextCursor: string | null }
  | { mode: "raw"; items: RawListItem[]; nextCursor: string | null };

/**
 * 주선자 프로필 목록 — 카드 보기와 원본 보기.
 *
 * 첫 페이지는 서버가 그려 넘기고, 스크롤이 끝에 닿으면 같은 조건으로 다음 페이지를
 * 불러 이어 붙인다. 조건이나 보기가 바뀌면 화면이 `key` 를 바꿔 새로 시작한다 —
 * 이 컴포넌트는 처음 받은 조건만 안다.
 */
export function HostProfileList({
  initial,
  /** 지금 조건(커서·보기 제외)의 쿼리스트링. */
  query,
}: {
  initial: Initial;
  query: string;
}) {
  const [page, setPage] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 관찰 콜백이 같은 커서로 두 번 부르지 않게 한다. state 는 다음 렌더에야 바뀐다.
  const inFlight = useRef(false);

  async function loadMore(): Promise<void> {
    if (!page.nextCursor || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    const params = new URLSearchParams(query);
    params.set("cursor", page.nextCursor);
    if (page.mode === "raw") params.set("view", "raw");
    const result = await apiGet<HostProfilePage>(`/api/admin/profiles/list?${params.toString()}`);
    inFlight.current = false;
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    const next = result.data;
    setPage((prev) => {
      // 사이에 끌어올림이 있으면 같은 사람이 두 페이지에 걸칠 수 있다 — 먼저 받은 쪽을 둔다.
      const seen = new Set(prev.items.map((item) => item.id));
      if (prev.mode === "card" && next.mode === "card") {
        return {
          mode: "card",
          nextCursor: next.nextCursor,
          items: [...prev.items, ...next.items.filter((item) => !seen.has(item.id))],
        };
      }
      if (prev.mode === "raw" && next.mode === "raw") {
        return {
          mode: "raw",
          nextCursor: next.nextCursor,
          items: [...prev.items, ...next.items.filter((item) => !seen.has(item.id))],
        };
      }
      return prev;
    });
  }

  return (
    <>
      {page.mode === "raw" ? (
        <ProfileRawList items={page.items} />
      ) : (
        <ul className="stagger mt-5 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">
          {page.items.map((item) => (
            <li key={item.id}>
              <ProfileCard item={item} />
            </li>
          ))}
        </ul>
      )}
      <LoadMore
        hasMore={page.nextCursor !== null}
        loading={loading}
        error={error}
        onLoad={() => void loadMore()}
      />
    </>
  );
}

function ProfileCard({ item }: { item: HostProfileCardItem }) {
  return (
    <Link href={`/profiles/${item.id}`} className="lift-move group block">
      <div className="lift-shadow relative aspect-3/4 overflow-hidden rounded-[var(--radius-card)] bg-[var(--color-ivory-200)]">
        {item.imageUrl ? (
          // signed URL 은 응답마다 새로 발급된다. next/image 최적화를 태우면
          // URL 이 캐시되어 만료 뒤 깨지므로 img 를 그대로 쓴다.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            className={cn(
              "h-full w-full object-cover transition-transform duration-[var(--duration-base)] group-hover:scale-[1.02]",
              // 비활성은 멤버에게 안 보인다 — 훑을 때 배지보다 먼저 눈에 걸리게 흑백으로 둔다.
              !item.visible && "grayscale",
            )}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[12px] text-[var(--color-ink-700)]">
            사진 없음
          </div>
        )}

        {/* 상태는 둘뿐이고 활성이 평소 모습이다 — 예외인 비활성만 사진 위에 띄운다. */}
        {!item.visible ? (
          <span className="absolute left-2.5 top-2.5 rounded-[var(--radius-pill)] bg-[var(--color-ink-900)]/70 px-2.5 py-1 text-[11.5px] text-white backdrop-blur">
            비활성 · 멤버에게 안 보임
          </span>
        ) : null}
      </div>

      <div className="mt-2.5">
        {/* 주선자는 번호가 아니라 이름으로 기억한다. 이름은 담당일 때만 온다. */}
        {item.name ? (
          <p className="display truncate text-[15px] text-[var(--color-ink-900)]">
            {item.name}
            <span className="ml-2 font-sans text-[12px] text-[var(--color-ink-500)]">
              {item.code} · {label.gender(item.gender)}
            </span>
          </p>
        ) : (
          <p className="display text-[15px] text-[var(--color-ink-900)]">
            <ProfileCode code={item.code} />
            <span className="ml-2 font-sans text-[12px] text-[var(--color-ink-500)]">
              {label.gender(item.gender)}
            </span>
          </p>
        )}
        <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-700)]">
          {label.birthYear(item.birthYear)}
        </p>
        {/* 키는 출생연도 옆에 두면 먼저 읽힌다. 직업·지역 줄 끝에 작게 붙인다. */}
        <p className="text-[12.5px] text-[var(--color-ink-600)]">
          {item.workLine}
          {item.height ? (
            <span className="text-[11.5px] text-[var(--color-ink-500)]">
              {item.workLine ? " · " : ""}
              {item.height}cm
            </span>
          ) : null}
        </p>
        <p className="mt-1 text-[11.5px] text-[var(--color-ink-500)]">
          {item.bumpedAt ? (
            <>
              <time dateTime={item.bumpedAt}>{formatDay(item.bumpedAt)}</time> 끌어올림
            </>
          ) : (
            <>
              <time dateTime={item.createdAt}>{formatDay(item.createdAt)}</time> 등록
            </>
          )}
        </p>
      </div>
    </Link>
  );
}
