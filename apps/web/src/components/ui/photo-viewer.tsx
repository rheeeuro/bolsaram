"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";

type Photo = { id: string; url: string };

/**
 * 사진을 화면 가득 크게 본다.
 *
 * 주선자 화면은 사진을 썸네일로만 늘어놓는데, 얼굴·분위기를 확인하려면 멤버 상세처럼
 * 크게 넘겨 봐야 한다. 넘기는 방식은 멤버 상세와 같다 — 가로 스냅 스크롤로 밀고,
 * 사진의 왼쪽·오른쪽을 누르면 한 장씩, 데스크톱은 사진 밖 화살표와 ←/→ 키로 넘긴다.
 *
 * 카드처럼 자르지 않고 원본 비율 그대로(`object-contain`) 보여준다. 크게 보는 이유가
 * 잘린 곳 없이 확인하는 것이기 때문이다. 바깥 어두운 곳을 누르거나 ESC 로 닫는다.
 */
export function PhotoViewer({
  photos,
  openIndex,
  onClose,
}: {
  photos: Photo[];
  /** 처음 보여줄 장. `null` 이면 닫혀 있다. */
  openIndex: number | null;
  onClose: () => void;
}) {
  const open = openIndex != null;
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(openIndex ?? 0);
  // 새로 열 때마다 고른 장에서 시작한다. 렌더 중에 맞춰 표시가 한 박자 늦지 않게 한다.
  const [lastOpen, setLastOpen] = useState(openIndex);
  if (openIndex !== lastOpen) {
    setLastOpen(openIndex);
    if (openIndex != null) setIndex(openIndex);
  }

  // 스크롤 위치도 그리기 전에 맞춘다 — 늦으면 첫 장이 한 번 비친다.
  useLayoutEffect(() => {
    if (openIndex == null) return;
    const el = trackRef.current;
    if (el) el.scrollLeft = openIndex * el.clientWidth;
  }, [openIndex]);

  function goTo(next: number) {
    const el = trackRef.current;
    if (!el || next < 0 || next >= photos.length) return;
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  }

  // 화살표 키는 Dialog 가 다루지 않는다. 열린 동안만 듣는다.
  const indexRef = useRef(index);
  useEffect(() => {
    indexRef.current = index;
  });
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") goTo(indexRef.current - 1);
      else if (event.key === "ArrowRight") goTo(indexRef.current + 1);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const many = photos.length > 1;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      label="사진 크게 보기"
      variant="full"
      backdrop={false}
      className="h-full animate-fade justify-center"
      style={{ background: "rgb(16 12 10 / 0.97)", padding: 0 }}
    >
      {/* 사진 바깥 빈 곳을 누르면 닫힌다. 사진·버튼 위의 클릭은 여기까지 오지 않게 막는다. */}
      <div
        className="flex h-full w-full flex-col items-center justify-center"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-3 py-3">
          {many ? (
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[12px] text-white">
              {index + 1}/{photos.length}
            </span>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path
                d="m5 5 10 10M15 5 5 15"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* 폭은 화면 폭과 (높이 − 위아래 띠) × 3/4 중 작은 쪽. 세로 사진이 화면에 다 들어온다. */}
        <div className="relative aspect-3/4 w-full max-w-[min(100vw,calc((100dvh_-_7.5rem)*0.75))]">
          <div
            ref={trackRef}
            onClick={(event) => {
              if (!many) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const leftSide = event.clientX - rect.left < rect.width / 2;
              goTo(index + (leftSide ? -1 : 1));
            }}
            onScroll={(event) => {
              const el = event.currentTarget;
              const next = Math.round(el.scrollLeft / el.clientWidth);
              if (next !== index) setIndex(next);
            }}
            className={cn(
              "no-scrollbar flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain outline-none",
              many && "cursor-pointer",
            )}
          >
            {photos.map((photo) => (
              // signed URL 은 단기 만료된다. next/image 캐싱을 피한다.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={photo.id}
                src={photo.url}
                alt=""
                draggable={false}
                className="h-full w-full shrink-0 snap-center snap-always object-contain"
              />
            ))}
          </div>

          {many ? (
            <>
              <ViewerArrow direction="prev" disabled={index === 0} onClick={() => goTo(index - 1)} />
              <ViewerArrow
                direction="next"
                disabled={index === photos.length - 1}
                onClick={() => goTo(index + 1)}
              />
            </>
          ) : null}
        </div>

        {many ? (
          <div className="absolute inset-x-0 bottom-2 flex justify-center">
            {photos.map((photo, i) => (
              <button
                key={photo.id}
                type="button"
                aria-label={`${i + 1}번째 사진`}
                aria-current={i === index}
                onClick={() => goTo(i)}
                className="grid h-8 place-items-center px-1"
              >
                <span
                  className={cn(
                    "block h-1.5 rounded-full transition-all duration-[var(--duration-quick)]",
                    i === index ? "w-5 bg-white" : "w-1.5 bg-white/45",
                  )}
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

/** 데스크톱 화살표. 사진 밖 양옆에 둔다 — 폰에서는 밀거나 눌러서 넘긴다. */
function ViewerArrow({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={direction === "prev" ? "이전 사진" : "다음 사진"}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white transition-opacity hover:bg-white/25 disabled:pointer-events-none disabled:opacity-0 sm:grid",
        direction === "prev" ? "-left-16" : "-right-16",
      )}
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path
          d={direction === "prev" ? "M12 4 6 10l6 6" : "M8 4l6 6-6 6"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
