"use client";

import { useState, type ReactNode } from "react";
import { PhotoViewer } from "@/components/ui/photo-viewer";
import { cn } from "@/lib/cn";

type Photo = { id: string; url: string };

/**
 * 목록의 사진을 누르면 상세로 가지 않고 그 자리에서 크게 본다.
 * 상세로 가는 길은 옆의 이름·번호 링크가 맡는다.
 *
 * 링크 안에 넣지 않는다 — 버튼이 링크 안에 있으면 누를 때 상세로도 넘어가고,
 * 크게 보기 화면은 포털로 그려져도 React 이벤트가 부모로 올라가 링크를 다시 누른다.
 * 같은 이유로 크게 보기 화면은 버튼의 자식이 아니라 형제로 둔다.
 */
export function PhotoZoom({
  photos,
  startIndex = 0,
  label = "사진 크게 보기",
  className,
  children,
}: {
  photos: Photo[];
  /** 처음 보여줄 장. */
  startIndex?: number;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        onClick={() => setOpenIndex(startIndex)}
        className={cn("block cursor-zoom-in text-left", className)}
      >
        {children}
      </button>
      <PhotoViewer photos={photos} openIndex={openIndex} onClose={() => setOpenIndex(null)} />
    </>
  );
}
