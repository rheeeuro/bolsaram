"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { label } from "@/lib/labels";
import { FavoriteButton } from "@/components/member/favorite-button";
import { AiRecommendBadge, ProfileCode } from "@/components/ui/marks";
import { PhotoZoom } from "@/components/ui/photo-zoom";
import type { ProfileCardView } from "@/server/views/profile-view";

/** 돌아갈 화면. 상세의 뒤로가기가 이 값을 읽는다. */
export type CardOrigin = "favorites" | "signals" | "hidden";

export function profileHref(id: string, from?: CardOrigin): string {
  return from ? `/discover/${id}?from=${from}` : `/discover/${id}`;
}

/**
 * 목록에 싣는 조각. 카드와 한 줄 목록이 같은 문장을 쓴다.
 * 키는 출생연도 옆에 두면 먼저 읽히므로 직업·지역 줄 끝에 `HeightNote` 로 작게 붙인다.
 */
export function cardLines(profile: ProfileCardView): {
  birth: string;
  height: string | null;
  work: string;
} {
  return {
    birth: `${profile.birthYear}년생`,
    height: profile.height ? `${profile.height}cm` : null,
    work: [label.jobCategory(profile.jobCategory), label.region(profile.residenceRegion)]
      .filter(Boolean)
      .join(" · "),
  };
}

/** 직업·지역 줄 끝에 붙는 키. 앞 줄이 비어 있으면 구분점 없이 키만 쓴다. */
export function HeightNote({ height, after }: { height: string | null; after: string }) {
  if (!height) return null;
  return (
    <span className="text-[11.5px] text-[var(--color-ink-500)]">
      {after ? " · " : ""}
      {height}
    </span>
  );
}

/**
 * 목록 등장 순서. 받은 순번을 `.animate-enter` 가 읽어 앞쪽 몇 개만 엇갈려 내보낸다.
 * 순번을 주지 않으면 모션 없이 그대로 그린다.
 */
export function enterProps(index: number | undefined): {
  className?: string;
  style?: CSSProperties;
} {
  if (index == null) return {};
  return { className: "animate-enter", style: { "--enter-i": index } as CSSProperties };
}

/**
 * Discover 카드 (UI 컨셉 02).
 * 리스트는 빠르고 기능적으로 — 공개 범위는 익명 코드/사진/출생연도/키/직업군/지역까지.
 */
export function ProfileCard({
  profile,
  from,
  index,
}: {
  profile: ProfileCardView;
  from?: CardOrigin;
  /** 목록 안 순번. 주면 등장 모션이 붙는다. */
  index?: number;
}) {
  const href = profileHref(profile.id, from);
  const lines = cardLines(profile);
  const enter = enterProps(index);
  return (
    <article className={cn("lift-move group relative", enter.className)} style={enter.style}>
      {/* 사진을 누르면 크게 보고, 상세는 아래 번호 링크로 간다. 사진이 없으면 빈 칸도 상세로 간다. */}
      {profile.primaryImage ? (
        <PhotoZoom
          photos={[profile.primaryImage]}
          profileId={profile.id}
          label={`${profile.code} 사진 크게 보기`}
          className="w-full"
        >
          <CardPhoto profile={profile} />
        </PhotoZoom>
      ) : (
        <Link href={href} aria-hidden tabIndex={-1} className="block">
          <CardPhoto profile={profile} />
        </Link>
      )}

      <FavoriteButton
        profileId={profile.id}
        initial={profile.isFavorited}
        className="right-1 top-1"
      />

      <Link href={href} className="mt-2.5 block">
        <ProfileCode
          code={profile.code}
          className="display text-[15px] text-[var(--color-ink-900)]"
        />
        {/* 사진 위 표시는 사진 버튼의 접근명에 묻힌다. 여기서 한 번 더 읽어 준다. */}
        {profile.aiRecommended ? <span className="sr-only">AI 추천</span> : null}
        <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-700)]">{lines.birth}</p>
        <p className="text-[12.5px] text-[var(--color-ink-600)]">
          {lines.work}
          <HeightNote height={lines.height} after={lines.work} />
        </p>
      </Link>
    </article>
  );
}

/** 카드 사진 칸. 사진이 있으면 크게 보기 버튼, 없으면 상세 링크가 감싼다. */
function CardPhoto({ profile }: { profile: ProfileCardView }) {
  return (
    <div className="lift-shadow relative aspect-3/4 overflow-hidden rounded-[var(--radius-card)] bg-[var(--color-ivory-200)]">
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
      {/* 하트가 오른쪽 위에 있으므로 왼쪽 위에 둔다. */}
      {profile.aiRecommended ? (
        <AiRecommendBadge onPhoto className="absolute left-2 top-2" />
      ) : null}
    </div>
  );
}
