"use client";

import { useState, useTransition } from "react";
import { apiDelete, apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";

/**
 * 목록에서 바로 누르는 관심 하트.
 * 카드(사진 위)와 한 줄 목록(오른쪽 끝) 둘 다 쓰므로 위치는 밖에서 정한다.
 *
 * 링크 안에 버튼을 넣을 수 없어서 목록 항목이 이 버튼을 형제로 두고 겹쳐 놓는다 —
 * 그래서 `className` 으로 절대 위치를 받는다.
 */
export function FavoriteButton({
  profileId,
  initial,
  className,
}: {
  profileId: string;
  initial: boolean;
  className?: string;
}) {
  const [favorited, setFavorited] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      {/* 실패하면 하트가 되돌아가는 것으로 보이지만, 화면을 보지 않으면 알 수 없다. */}
      <span role="status" className="sr-only">
        {failed ? "관심을 저장하지 못했습니다." : ""}
      </span>
      {/* 보이는 원은 32px 그대로 두고 누를 수 있는 범위만 44px 로 넓힌다 —
          사진 위에 더 큰 흰 원을 얹으면 카드가 무거워진다. */}
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
        className={cn("absolute grid h-11 w-11 place-items-center", className)}
      >
        <span
          className={cn(
            "grid h-8 w-8 place-items-center rounded-full bg-white/85 backdrop-blur",
            "transition-transform duration-[var(--duration-quick)]",
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
        </span>
      </button>
    </>
  );
}
