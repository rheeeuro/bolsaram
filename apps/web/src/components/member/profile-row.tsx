"use client";

import Link from "next/link";
import { FavoriteButton } from "@/components/member/favorite-button";
import { AiRecommendBadge, ProfileCode } from "@/components/ui/marks";
import { PhotoZoom } from "@/components/ui/photo-zoom";
import {
  cardLines,
  enterProps,
  HeightNote,
  profileHref,
  type CardOrigin,
} from "@/components/member/profile-card";
import { cn } from "@/lib/cn";
import type { ProfileCardView } from "@/server/views/profile-view";

/**
 * Discover 한 줄 목록 항목.
 *
 * 카드 격자는 사진이 먼저 읽히고 글자가 작아서, 여러 명을 훑어보려면 결국 하나씩 눌러야 한다.
 * 이 형태는 사진을 썸네일로 줄이고 같은 내용을 옆에 한 줄로 편다 — 공개 범위는 카드와 똑같다
 * (익명 코드·대표 사진·출생연도·키·직업군·지역).
 */
export function ProfileRow({
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
    <article className={cn("relative", enter.className)} style={enter.style}>
      {/* 사진은 크게 보기, 글자 쪽은 상세로 간다. 하트는 링크 안에 넣을 수 없어 형제로 겹친다.
          오른쪽 44px 는 그 자리로 비워 둔다. */}
      <div className="flex items-center gap-3 py-2.5 pr-12">
        {profile.primaryImage ? (
          <PhotoZoom
            photos={[profile.primaryImage]}
            profileId={profile.id}
            label={`${profile.code} 사진 크게 보기`}
            className="shrink-0"
          >
            <RowThumb profile={profile} />
          </PhotoZoom>
        ) : (
          <Link href={href} aria-hidden tabIndex={-1} className="shrink-0">
            <RowThumb profile={profile} />
          </Link>
        )}

        <Link href={href} className="flex min-w-0 flex-1 flex-col justify-center self-stretch">
          <p className="flex items-baseline gap-2">
            <ProfileCode
              code={profile.code}
              className="display text-[15px] text-[var(--color-ink-900)]"
            />
            <span className="truncate text-[12.5px] text-[var(--color-ink-700)]">
              {lines.birth}
            </span>
            {profile.aiRecommended ? <AiRecommendBadge className="self-center" /> : null}
          </p>
          <p className="mt-0.5 truncate text-[12.5px] text-[var(--color-ink-600)]">
            {lines.work}
            <HeightNote height={lines.height} after={lines.work} />
          </p>
        </Link>
      </div>

      <FavoriteButton
        profileId={profile.id}
        initial={profile.isFavorited}
        className="right-0 top-1/2 -translate-y-1/2"
      />
    </article>
  );
}

function RowThumb({ profile }: { profile: ProfileCardView }) {
  return (
    <div className="h-16 w-16 overflow-hidden rounded-[var(--radius-card)] bg-[var(--color-ivory-200)]">
      {profile.primaryImage ? (
        // signed URL 은 매 요청마다 새로 발급된다. next/image 최적화를 쓰면
        // URL 이 캐시되어 만료 후 깨지므로 img 를 그대로 쓴다.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profile.primaryImage.url}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full items-center justify-center px-1 text-center text-[10.5px] leading-tight text-[var(--color-ink-700)]">
          사진 준비 중
        </div>
      )}
    </div>
  );
}
