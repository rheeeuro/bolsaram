"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { FavoriteButton } from "@/components/member/favorite-button";
import { cardLines, enterProps, HeightNote, profileHref } from "@/components/member/profile-card";
import { AiRecommendBadge, ProfileCode } from "@/components/ui/marks";
import { PhotoAlbum } from "@/components/ui/photo-album";
import { cn } from "@/lib/cn";
import type { ProfileRawView } from "@/server/views/profile-view";

/**
 * Discover 「원본으로 보기」 한 줄.
 *
 * 카카오톡 방에서 프로필을 받아 보던 모양 그대로 **사진 묶음과 글을 나란히** 둔다 —
 * 카드는 한 사람씩 눌러 봐야 하지만 여기서는 스크롤만으로 상세 내용까지 훑는다.
 * 공개 범위는 상세 화면과 같다(익명 번호, 이름·연락처 없음). 글은 주선자가 받은 원문이
 * 아니라 정리된 항목이다 — 원문에는 이름·연락처가 섞여 있다.
 */
export function ProfileRawRow({ profile, index }: { profile: ProfileRawView; index?: number }) {
  const href = profileHref(profile.id);
  const lines = cardLines(profile);
  const enter = enterProps(index);
  return (
    <article
      className={cn(
        "relative rounded-[var(--radius-card)] border border-[var(--surface-border)] bg-white p-3.5",
        enter.className,
      )}
      style={enter.style}
    >
      {/* 하트는 링크 안에 넣을 수 없어 형제로 겹친다. 오른쪽은 그 자리로 비워 둔다. */}
      <Link href={href} className="flex items-baseline gap-2 pr-10">
        <ProfileCode code={profile.code} className="display text-[15px] text-[var(--color-ink-900)]" />
        <span className="truncate text-[12.5px] text-[var(--color-ink-700)]">
          {lines.birth}
          <HeightNote height={lines.height} after={lines.birth} />
        </span>
        {profile.aiRecommended ? <AiRecommendBadge className="self-center" /> : null}
      </Link>
      <FavoriteButton
        profileId={profile.id}
        initial={profile.isFavorited}
        className="right-1.5 top-1.5"
      />

      {/* 사진이 왼쪽, 글이 오른쪽. 좁은 화면에서는 사진 아래로 글이 내려온다. */}
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        {profile.images.length > 0 ? (
          <PhotoAlbum href={href} images={profile.images} className="w-44 sm:w-48" />
        ) : (
          // 사진이 없어도 자리는 같게 둔다 — 줄마다 글 시작점이 달라지면 훑기 어렵다.
          <Link
            href={href}
            aria-hidden
            tabIndex={-1}
            className="flex aspect-3/4 w-44 shrink-0 items-center justify-center rounded-[var(--radius-card)] bg-[var(--color-ivory-200)] text-[12px] text-[var(--color-ink-700)] sm:w-48"
          >
            사진 준비 중
          </Link>
        )}

        <div className="min-w-0 flex-1">
          {profile.summary ? (
            <SummaryBubble text={profile.summary} href={href} />
          ) : (
            <p className="rounded-lg bg-[var(--color-ivory-100)] px-3.5 py-3 text-[12.5px] text-[var(--color-ink-600)]">
              아직 적힌 소개가 없어요.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * 정리된 글. 긴 글이 목록을 밀어내지 않도록 몇 줄까지만 보이고 「더 보기」로 편다.
 * 안쪽 스크롤은 쓰지 않는다 — 휴대폰에서 목록 스크롤과 엉킨다.
 */
function SummaryBubble({ text, href }: { text: string; href: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);

  // 잘렸는지는 그려 본 뒤에야 안다. 펴기 전 높이로만 잰다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    setClipped(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);

  return (
    <div className="rounded-lg bg-[var(--color-ivory-100)] px-3.5 py-3">
      <p
        ref={ref}
        className={cn(
          "whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[var(--color-ink-800)]",
          !open && "line-clamp-[12]",
        )}
      >
        {text}
      </p>
      <div className="mt-2 flex items-center gap-3 text-[12.5px]">
        {clipped ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="text-[var(--color-rose-600)] underline-offset-4 hover:underline"
          >
            {open ? "접기" : "더 보기"}
          </button>
        ) : null}
        <Link
          href={href}
          className="ml-auto text-[var(--color-ink-600)] underline-offset-4 hover:text-[var(--color-rose-600)] hover:underline"
        >
          프로필 열기
        </Link>
      </div>
    </div>
  );
}
