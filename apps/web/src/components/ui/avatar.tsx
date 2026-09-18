import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * 사람·모임을 가리키는 동그란 자리.
 *
 * 사진이 있으면 사진을, 없으면 **이름의 앞글자**를 그린다. 사진이 없는 것이 정상이라
 * 빈 자리를 만들지 않는다 — 주선자가 방금 가입했거나 모임을 막 만들었으면 사진이 없다.
 *
 * 크기·모양·색은 쓰는 쪽이 `className` 으로 정한다. 사이드바의 24px 부터 계정 설정의
 * 56px 까지 같은 물건이 여러 크기로 나오기 때문이다.
 *
 * 장식이다 — 옆에 항상 이름이 글자로 있으므로 `aria-hidden` 으로 숨긴다.
 */
export function Avatar({
  src,
  name,
  fallback,
  className,
}: {
  /** 단기 signed URL. 응답마다 새로 발급된 값이어야 한다. */
  src?: string | null;
  name?: string | null;
  /** 앞글자 대신 그릴 것 — 전체공개 채널처럼 이름의 첫 글자가 어울리지 않는 자리. */
  fallback?: ReactNode;
  className?: string;
}) {
  if (src) {
    return (
      <span aria-hidden className={cn("relative overflow-hidden", className)}>
        {/* signed URL 은 응답마다 새로 발급된다 — next/image 최적화를 태우지 않는다. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
      </span>
    );
  }

  return (
    <span aria-hidden className={className}>
      {fallback ?? Array.from((name ?? "").trim())[0] ?? "·"}
    </span>
  );
}
