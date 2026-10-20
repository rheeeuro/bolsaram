import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ProfileCode } from "@/components/ui/marks";
import { PhotoAlbum } from "@/components/ui/photo-album";
import { formatWhen } from "@/lib/dates";
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
  /** 담당일 때만 온다. 주선자는 번호보다 이름으로 기억한다. */
  name: string | null;
  gender: string;
  birthYear: number;
  visible: boolean;
  images: { id: string; url: string }[];
  /** 가져오기로 받은 원문. 세션이 없거나 담당이 아니면 null 이다. */
  rawText: string | null;
  /** 담당이 아니라 원본을 읽을 수 없다 — 원문이 없는 것과 다르게 안내한다. */
  sourceHidden: boolean;
  /** 원문이 없을 때 대신 보여줄 정리된 내용(줄글). 보여도 되는 값만 담는다. */
  summary: string | null;
  source: string | null;
  at: string | null;
};

export function ProfileRawList({ items }: { items: RawListItem[] }) {
  return (
    <ul className="stagger mt-5 flex flex-col gap-3">
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
              {item.name ?? <ProfileCode code={item.code} />}
            </Link>
            <span className="text-[12.5px] text-[var(--color-ink-500)]">
              {item.name ? `${item.code} · ` : ""}
              {label.gender(item.gender)} · {label.birthYear(item.birthYear)}
            </span>
            {!item.visible ? <Badge tone="neutral">비활성 · 멤버에게 안 보임</Badge> : null}

            <span className="ml-auto text-[11.5px] text-[var(--surface-text-muted)]">
              {[
                item.source ? label.importSource(item.source) : null,
                item.at ? formatWhen(item.at) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>

          {/* 사진이 왼쪽, 원문이 오른쪽. 좁은 화면에서는 사진 아래로 글이 내려온다. */}
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            {item.images.length > 0 ? (
              <PhotoAlbum images={item.images} muted={!item.visible} className="w-40 sm:w-52" />
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
              ) : item.summary ? (
                // 원문 대신 정리된 내용을 같은 자리에 둔다. 원문이 아니라는 것은 머리말로 밝힌다.
                <div className="rounded-lg bg-[var(--color-ivory-100)] px-3.5 py-3">
                  <p className="text-[11.5px] text-[var(--surface-text-muted)]">
                    {fallbackNote(item)}
                  </p>
                  <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[var(--color-ink-800)]">
                    {item.summary}
                  </p>
                </div>
              ) : (
                <p className="rounded-lg bg-[var(--color-ivory-100)] px-3.5 py-3 text-[12.5px] text-[var(--surface-text-muted)]">
                  {fallbackNote(item)}
                </p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** 원문을 못 보여주는 이유. 정리된 내용이 있으면 그 머리말이 된다. */
function fallbackNote(item: RawListItem): string {
  const reason = item.sourceHidden
    ? "원본은 등록한 주선자만 봅니다."
    : item.source
      ? "사진만 받았고 글은 없습니다."
      : "가져온 원본이 없습니다.";
  return item.summary
    ? `${reason} 정리된 내용입니다.`
    : `${reason} 정리된 내용은 프로필에서 봅니다.`;
}
