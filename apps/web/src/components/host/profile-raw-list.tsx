import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ProfileCode } from "@/components/ui/marks";
import { label } from "@/lib/labels";
import { cn } from "@/lib/cn";

/**
 * 프로필 목록의 「원본 보기」.
 *
 * 한 줄에 **사진과 가져올 때 받은 글을 나란히** 둔다. 카드 보기는 정리된 항목을
 * 보여주므로 "이 사람이 누구였더라"를 떠올리기 어렵다 — 여기서는 주선자가 카카오톡에서
 * 받아 본 그대로 사진과 글을 함께 훑는다.
 *
 * 순서는 카드 보기와 같다 — 사진 있는 사람이 먼저이고 그 안에서 최신순이다.
 * 시간순이 아니므로 날짜로 묶지 않고, 시각은 항목마다 적는다.
 */
export type RawListItem = {
  id: string;
  code: string;
  gender: string;
  age: number;
  status: string;
  visible: boolean;
  claimed: boolean;
  images: { id: string; url: string }[];
  /** 가져오기로 받은 원문. 세션이 없거나(시드) 남의 전체공개 건이면 null 이다. */
  rawText: string | null;
  source: string | null;
  at: string | null;
};

export function ProfileRawList({ items }: { items: RawListItem[] }) {
  return (
    <ul className="mt-5 flex flex-col gap-3">
      {items.map((item) => (
        <li
          key={item.id}
          className={cn(
            "rounded-[var(--radius-card)] border border-[var(--surface-border)]",
            "bg-[var(--surface-card)] p-4 shadow-[var(--shadow-card)]",
          )}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/profiles/${item.id}`}
              className="display text-[15px] text-[var(--color-ink-900)] hover:underline"
            >
              <ProfileCode code={item.code} />
            </Link>
            <span className="text-[12.5px] text-[var(--color-ink-500)]">
              {label.gender(item.gender)} · {item.age}세
            </span>
            <Badge tone={item.visible ? "active" : "neutral"}>
              {item.visible ? "멤버에게 보임" : "멤버에게 안 보임"}
            </Badge>
            {!item.claimed ? <Badge tone="neutral">초대 전</Badge> : null}

            <span className="ml-auto text-[11.5px] text-[var(--surface-text-muted)]">
              {[item.source ? label.importSource(item.source) : null, item.at ? formatWhen(item.at) : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>

          {/* 사진이 왼쪽, 원문이 오른쪽. 좁은 화면에서는 사진 아래로 글이 내려온다. */}
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            {item.images.length > 0 ? (
              <PhotoAlbum profileId={item.id} images={item.images} />
            ) : (
              // 사진이 없어도 자리는 같게 둔다 — 줄마다 글 시작점이 달라지면 훑기 어렵다.
              <div className="flex aspect-3/4 w-40 shrink-0 items-center justify-center rounded-[var(--radius-card)] bg-[var(--color-ivory-200)] text-[12px] text-[var(--color-ink-700)] sm:w-52">
                사진 없음
              </div>
            )}

            <div className="min-w-0 flex-1">
              {item.rawText ? (
                // 긴 글이 목록을 밀어내지 않도록 높이를 정하고 그 안에서 스크롤한다.
                <p className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--color-ivory-100)] px-3.5 py-3 text-[13px] leading-relaxed text-[var(--color-ink-800)]">
                  {item.rawText}
                </p>
              ) : (
                <p className="rounded-lg bg-[var(--color-ivory-100)] px-3.5 py-3 text-[12.5px] text-[var(--surface-text-muted)]">
                  {item.images.length > 0
                    ? "사진만 받았고 글은 없습니다."
                    : "가져온 원본이 없습니다. 정리된 내용은 프로필에서 봅니다."}
                </p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * 사진 묶음. 카카오톡에서 여러 장을 한 번에 보냈을 때처럼 **한 덩어리**로 붙인다 —
 * 장수에 따라 칸이 갈리고(1·2·3·4), 다섯 장부터는 마지막 칸에 남은 수를 얹는다.
 * 나머지 사진은 상세에 전부 있으므로 여기서는 묶음의 모양을 지키는 쪽을 택한다.
 *
 * 어느 칸을 눌러도 그 사람의 상세로 간다 — 원본을 보다가 할 일은 언제나 상세다.
 */
function PhotoAlbum({
  profileId,
  images,
}: {
  profileId: string;
  images: { id: string; url: string }[];
}) {
  const shown = images.slice(0, 4);
  const rest = images.length - shown.length;
  const count = shown.length;

  return (
    <div
      className={cn(
        "grid shrink-0 gap-[3px] overflow-hidden rounded-[var(--radius-card)] bg-[var(--color-ivory-200)]",
        "w-40 sm:w-52",
        // 한 장은 사람 사진 비율 그대로, 여러 장은 정사각 덩어리가 된다.
        count === 1 ? "aspect-3/4 grid-cols-1" : "aspect-square grid-cols-2",
        count === 3 ? "grid-rows-2" : null,
        count >= 4 ? "grid-rows-2" : null,
      )}
    >
      {shown.map((image, index) => (
        <Link
          key={image.id}
          href={`/profiles/${profileId}`}
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
            className="h-full w-full object-cover transition-transform duration-[var(--duration-base)] group-hover:scale-[1.03]"
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

/** 오늘이면 시각만, 다른 날이면 날짜까지. 대화 화면과 같은 규칙이다. */
function formatWhen(iso: string): string {
  const at = new Date(iso);
  const today = new Date();
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate();
  return at.toLocaleString("ko-KR", {
    ...(sameDay ? {} : { year: "2-digit", month: "numeric", day: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}
