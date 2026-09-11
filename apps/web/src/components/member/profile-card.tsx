"use client";

import Link from "next/link";
import { label } from "@/lib/labels";
import { FavoriteButton } from "@/components/member/favorite-button";
import type { ProfileCardView } from "@/server/views/profile-view";

/** 돌아갈 화면. 상세의 뒤로가기가 이 값을 읽는다. */
export type CardOrigin = "favorites" | "signals" | "hidden";

export function profileHref(id: string, from?: CardOrigin): string {
  return from ? `/discover/${id}?from=${from}` : `/discover/${id}`;
}

/** 목록에 싣는 두 줄. 카드와 한 줄 목록이 같은 문장을 쓴다. */
export function cardLines(profile: ProfileCardView): { facts: string; work: string } {
  return {
    facts: `${profile.birthYear}년생${profile.height ? ` · ${profile.height}cm` : ""}`,
    work: [label.jobCategory(profile.jobCategory), label.region(profile.residenceRegion)]
      .filter(Boolean)
      .join(" · "),
  };
}

/**
 * Discover 카드 (UI 컨셉 02).
 * 리스트는 빠르고 기능적으로 — 공개 범위는 익명 코드/사진/출생연도/키/직업군/지역까지.
 */
export function ProfileCard({
  profile,
  from,
}: {
  profile: ProfileCardView;
  from?: CardOrigin;
}) {
  const href = profileHref(profile.id, from);
  const lines = cardLines(profile);
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

      <FavoriteButton
        profileId={profile.id}
        initial={profile.isFavorited}
        className="right-1 top-1"
      />

      <Link href={href} className="mt-2.5 block">
        <p className="display text-[15px] text-[var(--color-ink-900)]">{profile.code}</p>
        <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-700)]">{lines.facts}</p>
        <p className="text-[12.5px] text-[var(--color-ink-600)]">{lines.work}</p>
      </Link>
    </article>
  );
}
