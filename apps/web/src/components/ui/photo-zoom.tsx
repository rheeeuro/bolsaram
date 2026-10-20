"use client";

import { useRef, useState, type ReactNode } from "react";
import { PhotoViewer } from "@/components/ui/photo-viewer";
import { apiGet } from "@/lib/api-client";
import { cn } from "@/lib/cn";

type Photo = { id: string; url: string };

/**
 * 목록의 사진을 누르면 상세로 가지 않고 그 자리에서 크게 본다.
 * 상세로 가는 길은 옆의 이름·번호 링크가 맡는다.
 *
 * 목록은 대표 사진 한 장만 싣는다. `profileId` 를 주면 누르는 순간 가진 사진으로 먼저
 * 열고, 상세 API 로 그 사람의 사진 전체를 받아 이어서 넘겨 보게 한다 — 공개 범위와
 * 권한 판정은 상세 화면과 같은 경로가 한다. 받지 못하면 가진 사진만 보여준다.
 *
 * 링크 안에 넣지 않는다 — 버튼이 링크 안에 있으면 누를 때 상세로도 넘어가고,
 * 크게 보기 화면은 포털로 그려져도 React 이벤트가 부모로 올라가 링크를 다시 누른다.
 * 같은 이유로 크게 보기 화면은 버튼의 자식이 아니라 형제로 둔다.
 */
export function PhotoZoom({
  photos,
  profileId,
  startIndex = 0,
  label = "사진 크게 보기",
  className,
  children,
}: {
  photos: Photo[];
  /** 주면 열 때 그 사람의 사진 전체를 받아 온다. */
  profileId?: string;
  /** 처음 보여줄 장. */
  startIndex?: number;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [shown, setShown] = useState(photos);
  // 닫았다가 다시 연 뒤에 늦게 온 이전 응답이 화면을 바꾸지 않게 한다.
  const openSeq = useRef(0);

  async function open() {
    const seq = ++openSeq.current;
    setShown(photos);
    setOpenIndex(startIndex);
    if (!profileId) return;
    const result = await apiGet<{ images: Photo[] }>(`/api/profiles/${profileId}`);
    if (seq !== openSeq.current || !result.ok || result.data.images.length === 0) return;
    const all = result.data.images.map(({ id, url }) => ({ id, url }));
    // 누른 사진이 전체 중 몇 번째인지 찾아 그 자리를 지킨다. 목록에 따라 사진 id 가
    // 없고 주소만 있다 — 주소는 같은 만료 구간 안에서 같다.
    const current = photos[startIndex];
    const at = current
      ? all.findIndex((photo) => photo.id === current.id || photo.url === current.url)
      : -1;
    setShown(all);
    setOpenIndex(at >= 0 ? at : 0);
  }

  return (
    <>
      <button
        type="button"
        aria-label={label}
        onClick={() => void open()}
        className={cn("block cursor-zoom-in text-left", className)}
      >
        {children}
      </button>
      <PhotoViewer
        photos={shown}
        openIndex={openIndex}
        onClose={() => {
          openSeq.current += 1;
          setOpenIndex(null);
        }}
      />
    </>
  );
}
