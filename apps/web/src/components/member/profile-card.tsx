"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { label } from "@/lib/labels";
import { apiDelete, apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { ProfileCardView } from "@/server/views/profile-view";

/**
 * Discover 카드 (UI 컨셉 02).
 * 리스트는 빠르고 기능적으로 — 공개 범위는 익명 코드/사진/출생연도/키/직업군/지역까지.
 */
export function ProfileCard({
  profile,
  from,
}: {
  profile: ProfileCardView;
  /** 돌아갈 화면. 상세의 뒤로가기가 이 값을 읽는다. */
  from?: "favorites" | "signals" | "hidden";
}) {
  const href = from ? `/discover/${profile.id}?from=${from}` : `/discover/${profile.id}`;
  return (
    <article className="group relative">
      {/* 사진은 장식이라 접근명이 없다. 같은 곳으로 가는 링크가 아래에 하나 더 있으므로
          이쪽은 접근성 트리에서 감춘다 — 그러지 않으면 이름 없는 링크가 하나 더 읽힌다. */}
      <Link href={href} aria-hidden tabIndex={-1} className="block">
        <div className="relative aspect-3/4 overflow-hidden rounded-[var(--radius-card)] bg-[var(--color-ivory-200)]">
          {profile.primaryImage ? (
            // signed URL 은 매 요청마다 새로 발급된다. next/image 최적화를 쓰면
            // URL 이 캐시되어 만료 후 깨지므로 img 를 그대로 쓴다.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.primaryImage.url}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-[var(--duration-base)] group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-[var(--color-ink-700)]">
              사진 준비 중
            </div>
          )}
        </div>
      </Link>

      <FavoriteButton profileId={profile.id} initial={profile.isFavorited} />

      <Link href={href} className="mt-2.5 block">
        <p className="display text-[15px] text-[var(--color-ink-900)]">{profile.code}</p>
        <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-700)]">
          {profile.birthYear}년생{profile.height ? ` · ${profile.height}cm` : ""}
        </p>
        <p className="text-[12.5px] text-[var(--color-ink-600)]">
          {[label.jobCategory(profile.jobCategory), label.region(profile.residenceRegion)]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </Link>
    </article>
  );
}

function FavoriteButton({ profileId, initial }: { profileId: string; initial: boolean }) {
  const [favorited, setFavorited] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      {/* 실패하면 하트가 되돌아가는 것으로 보이지만, 화면을 보지 않으면 알 수 없다. */}
      <span role="status" className="sr-only">
        {failed ? "관심을 저장하지 못했습니다." : ""}
      </span>
      <button
        type="button"
        aria-label={favorited ? "관심 해제" : "관심 저장"}
        aria-pressed={favorited}
        disabled={pending}
        onClick={() => {
          // 낙관적으로 먼저 반영하고, 실패하면 되돌린다.
          const next = !favorited;
          setFavorited(next);
          setFailed(false);
          startTransition(async () => {
            const result = next
              ? await apiPost("/api/favorites", { profileId })
              : await apiDelete("/api/favorites", { profileId });
            if (!result.ok) {
              setFavorited(!next);
              setFailed(true);
            }
          });
        }}
        className={cn(
          "absolute right-2.5 top-2.5 grid h-8 w-8 place-items-center rounded-full",
          "bg-white/85 backdrop-blur transition-transform duration-[var(--duration-quick)]",
          "active:scale-90",
        )}
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M10 16s-6-3.7-6-7.6A3.4 3.4 0 0 1 10 6.3a3.4 3.4 0 0 1 6 2.1C16 12.3 10 16 10 16Z"
            stroke={favorited ? "var(--color-rose-500)" : "var(--color-ink-600)"}
            strokeWidth="1.4"
            strokeLinejoin="round"
            fill={favorited ? "var(--color-rose-500)" : "none"}
          />
        </svg>
      </button>
    </>
  );
}
