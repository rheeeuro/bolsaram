import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * 사진 묶음. 카카오톡에서 여러 장을 한 번에 보냈을 때처럼 **한 덩어리**로 붙인다 —
 * 장수에 따라 칸이 갈리고(1·2·3·4), 다섯 장부터는 마지막 칸에 남은 수를 얹는다.
 * 나머지 사진은 상세에 전부 있으므로 여기서는 묶음의 모양을 지키는 쪽을 택한다.
 *
 * 어느 칸을 눌러도 그 사람의 상세로 간다 — 원본을 보다가 할 일은 언제나 상세다.
 * 주선자 「받은 원본」과 멤버 「원본으로 보기」가 같은 모양을 쓴다.
 */
export function PhotoAlbum({
  href,
  images,
  muted = false,
  className,
}: {
  href: string;
  images: { id: string; url: string }[];
  /** 비활성 프로필 — 사진을 흑백으로 둔다. */
  muted?: boolean;
  /** 폭. 비율은 장수가 정한다. */
  className?: string;
}) {
  const shown = images.slice(0, 4);
  const rest = images.length - shown.length;
  const count = shown.length;

  return (
    <div
      className={cn(
        "grid shrink-0 gap-[3px] overflow-hidden rounded-[var(--radius-card)] bg-[var(--color-ivory-200)]",
        // 한 장은 사람 사진 비율 그대로, 여러 장은 정사각 덩어리가 된다.
        count === 1 ? "aspect-3/4 grid-cols-1" : "aspect-square grid-cols-2",
        count === 3 ? "grid-rows-2" : null,
        count >= 4 ? "grid-rows-2" : null,
        className,
      )}
    >
      {shown.map((image, index) => (
        <Link
          key={image.id}
          href={href}
          // 같은 곳으로 가는 링크가 칸마다 있다 — 읽기 순서에는 이름 링크 하나만 남긴다.
          aria-hidden
          tabIndex={-1}
          className={cn(
            "group relative block overflow-hidden bg-[var(--color-ivory-200)]",
            // 세 장이면 첫 장이 왼쪽을 세로로 차지한다.
            count === 3 && index === 0 ? "row-span-2" : null,
          )}
        >
          {/* signed URL 은 응답마다 새로 발급된다 — next/image 최적화를 태우지 않는다. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt=""
            loading="lazy"
            className={cn(
              "h-full w-full object-cover transition-transform duration-[var(--duration-base)] group-hover:scale-[1.03]",
              muted && "grayscale",
            )}
          />
          {rest > 0 && index === shown.length - 1 ? (
            <span className="absolute inset-0 flex items-center justify-center bg-[var(--color-ink-900)]/55 text-[15px] font-medium text-white">
              +{rest}
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
