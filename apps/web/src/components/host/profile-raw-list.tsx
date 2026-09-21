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
              <div className="grid shrink-0 grid-cols-4 gap-1.5 sm:w-52 sm:grid-cols-2">
                {item.images.map((image) => (
                  <Link
                    key={image.id}
                    href={`/profiles/${item.id}`}
                    className="group block aspect-3/4 overflow-hidden rounded-lg bg-[var(--color-ivory-200)]"
                  >
                    {/* signed URL 은 응답마다 새로 발급된다 — next/image 최적화를 태우지 않는다. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-[var(--duration-base)] group-hover:scale-[1.03]"
                    />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex aspect-3/4 w-24 shrink-0 items-center justify-center rounded-lg bg-[var(--color-ivory-200)] text-[12px] text-[var(--color-ink-700)] sm:w-[6.5rem]">
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
