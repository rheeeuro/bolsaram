"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { clampOffset, coverScale, cropRect, outputSize, type Point } from "@/lib/crop-rect";
import { cn } from "@/lib/cn";

/**
 * 올리기 전에 사진의 **어디를 쓸지** 정하는 창.
 *
 * 화면은 사진을 언제나 잘라서 보여준다 — 계정·모임 사진은 정사각, 프로필 사진은 3:4 다.
 * 자르는 자리를 서버가 정하면(가운데 고정) 얼굴이 잘린 카드가 그대로 목록에 남는다.
 * 그래서 고른 직후 이 창을 띄우고, 사람이 맞춘 영역만 실제로 올린다.
 *
 * 틀은 고정하고 **사진을 움직인다** — 틀을 끌게 하면 세로 사진에서 틀이 사진 밖으로
 * 나가고, 결과 비율이 화면과 달라진다. 사진은 언제나 틀을 덮는 범위 안에서만 움직여
 * 빈자리가 생기지 않는다.
 *
 * 자른 결과만 올라가므로 원본은 서버에 남지 않는다. 브라우저가 열지 못하는 형식(HEIC 등)은
 * 자르지 못하므로 원본 그대로 올리는 길을 남긴다.
 */

/** 저장할 긴 변의 한계. 화면에 쓰이는 크기보다 넉넉하고, 원본 그대로보다 훨씬 가볍다. */
const MAX_OUTPUT = 1280;
const MAX_ZOOM = 4;
/** 투명도를 잃지 않으면서 가장 가벼운 형식. 서버 허용 목록(`storage/local.ts`)에 있다. */
const OUTPUT_TYPE = "image/webp";
const OUTPUT_QUALITY = 0.92;
/** 화살표 한 번에 움직이는 거리(px). */
const NUDGE = 12;

export function ImageCropper({
  file,
  aspect,
  shape,
  step,
  onCancel,
  onApply,
}: {
  file: File;
  /** 가로 / 세로. 계정·모임 사진은 1, 프로필 사진은 3/4. */
  aspect: number;
  /** 화면에서 보이는 모양. 자른 결과는 언제나 네모이고, 여기서는 가이드만 바뀐다. */
  shape: "circle" | "square";
  /** 여러 장을 차례로 자를 때의 진행. 한 장이면 없다. */
  step?: { current: number; total: number };
  onCancel: () => void;
  /** 자른 파일. 브라우저가 열지 못한 사진은 원본 그대로 온다. */
  onApply: (file: File) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [frame, setFrame] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);

  // 파일은 메모리에 붙잡히므로 창이 닫힐 때 반드시 놓는다.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    setNatural(null);
    setFailed(false);
    setZoom(1);
    zoomRef.current = 1;
    setOffset({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // 틀의 실제 크기는 화면 폭에 따라 달라진다. 자를 좌표를 이 크기로 계산하므로 계속 본다.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () =>
      setFrame({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [src, failed]);

  /** 사진이 틀을 꼭 덮는 배율. 여기서부터 확대만 한다 — 축소하면 빈자리가 생긴다. */
  const base = natural && frame.width > 0 ? coverScale(natural, frame) : 0;
  const displayWidth = natural ? natural.width * base * zoom : 0;
  const displayHeight = natural ? natural.height * base * zoom : 0;

  const clamp = useCallback(
    (next: Point, width: number, height: number): Point =>
      clampOffset(next, { width, height }, frame),
    [frame],
  );

  // 확대는 한 번의 끌기 안에서 여러 번 연달아 불린다. 그때마다 렌더를 기다리면 직전
  // 배율을 놓치므로 지금 값을 따로 들고 본다.
  const zoomRef = useRef(1);

  /** 확대·축소는 틀 가운데를 기준으로 한다 — 사람이 가운데에 맞춰 둔 것이 그대로 남는다. */
  const applyZoom = useCallback(
    (next: number) => {
      if (!natural) return;
      const value = Math.min(MAX_ZOOM, Math.max(1, next));
      const ratio = value / zoomRef.current;
      zoomRef.current = value;
      setZoom(value);
      setOffset((current) =>
        clamp(
          { x: current.x * ratio, y: current.y * ratio },
          natural.width * base * value,
          natural.height * base * value,
        ),
      );
    },
    [base, clamp, natural],
  );

  // 끌기와 두 손가락 확대. 포인터를 한 곳에 모아 마우스·손가락을 같은 길로 다룬다.
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!natural) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      pinch.current = { distance: pointerDistance(), zoom: zoomRef.current };
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous || !natural) return;
    const next = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, next);

    if (pointers.current.size >= 2 && pinch.current) {
      const distance = pointerDistance();
      if (distance > 0) applyZoom((pinch.current.zoom * distance) / pinch.current.distance);
      return;
    }

    setOffset((current) =>
      clamp(
        { x: current.x + (next.x - previous.x), y: current.y + (next.y - previous.y) },
        displayWidth,
        displayHeight,
      ),
    );
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  function pointerDistance(): number {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // React 는 wheel 을 passive 로 걸어 `preventDefault` 가 통하지 않는다 — 직접 단다.
  // 막지 않으면 확대할 때 뒤 화면이 함께 스크롤된다.
  useEffect(() => {
    const el = frameRef.current;
    if (!el || !natural) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      applyZoom(zoomRef.current * (event.deltaY > 0 ? 0.92 : 1.08));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyZoom, natural]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const move: Record<string, Point> = {
      ArrowLeft: { x: -NUDGE, y: 0 },
      ArrowRight: { x: NUDGE, y: 0 },
      ArrowUp: { x: 0, y: -NUDGE },
      ArrowDown: { x: 0, y: NUDGE },
    };
    const delta = move[event.key];
    if (delta) {
      event.preventDefault();
      setOffset((current) =>
        clamp({ x: current.x + delta.x, y: current.y + delta.y }, displayWidth, displayHeight),
      );
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      applyZoom(zoomRef.current + 0.2);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      applyZoom(zoomRef.current - 0.2);
    }
  }

  async function apply() {
    const image = imageRef.current;
    if (!image || !natural || frame.width === 0) return;
    setBusy(true);
    const cropped = await cutOut(image, {
      frame,
      offset,
      scale: base * zoom,
      name: file.name,
    });
    setBusy(false);
    // 캔버스가 비어 오면(메모리 부족 등) 원본을 올린다 — 자르기 때문에 못 올리는 일은 없다.
    onApply(cropped ?? file);
  }

  const label = step && step.total > 1 ? `사진 자르기 ${step.current}/${step.total}` : "사진 자르기";

  return (
    <Dialog open onClose={onCancel} label={label} className="max-w-md">
      <h2 className="text-[15px] font-semibold text-[var(--surface-text)]">
        {label}
      </h2>
      <p className="mt-1 text-[12px] leading-relaxed text-[var(--surface-text-muted)]">
        {failed
          ? "이 형식은 미리 볼 수 없어 자를 수 없습니다. 원본 그대로 올립니다."
          : "끌어서 자리를 맞추고, 아래에서 크기를 조절하세요. 보이는 부분만 저장됩니다."}
      </p>

      {failed ? null : (
        <>
          <div
            ref={frameRef}
            role="group"
            aria-label="사진 위치와 크기"
            tabIndex={0}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{ aspectRatio: String(aspect), touchAction: "none" }}
            className={cn(
              "relative mx-auto mt-4 w-full max-w-[19rem] cursor-grab select-none overflow-hidden",
              "rounded-[var(--radius-card)] bg-[var(--color-ink-900)]",
              "outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-rose-400)]",
              "active:cursor-grabbing",
            )}
          >
            {src ? (
              // signed URL 이 아니라 방금 고른 파일이라 next/image 를 태우지 않는다.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={imageRef}
                src={src}
                alt=""
                draggable={false}
                onLoad={(event) => {
                  const target = event.currentTarget;
                  setNatural({ width: target.naturalWidth, height: target.naturalHeight });
                  zoomRef.current = 1;
                  setZoom(1);
                  setOffset({ x: 0, y: 0 });
                }}
                onError={() => setFailed(true)}
                style={{
                  width: displayWidth > 0 ? `${displayWidth}px` : "auto",
                  height: displayHeight > 0 ? `${displayHeight}px` : "auto",
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                  visibility: natural ? "visible" : "hidden",
                }}
                className="absolute left-1/2 top-1/2 max-w-none"
              />
            ) : null}

            {/* 실제로 저장되는 영역은 틀 전체다. 동그란 자리에 쓰일 사진만 원을 덧그려
                어디가 잘려 보일지 미리 알려준다. */}
            <div aria-hidden className="pointer-events-none absolute inset-0">
              {shape === "circle" ? (
                <div className="absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(24,18,20,0.55)]" />
              ) : null}
              <div
                className={cn(
                  "absolute inset-0 border border-white/70",
                  shape === "circle" ? "rounded-full" : "rounded-[var(--radius-card)]",
                )}
              />
            </div>
          </div>

          <label className="mt-3 flex items-center gap-3">
            <span className="text-[11.5px] text-[var(--surface-text-muted)]">크기</span>
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              disabled={!natural}
              onChange={(event) => applyZoom(Number(event.target.value))}
              className="h-1.5 w-full cursor-pointer accent-[var(--color-rose-500)]"
            />
          </label>
        </>
      )}

      <div className="mt-5 flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          취소
        </Button>
        {failed ? (
          <Button size="sm" onClick={() => onApply(file)}>
            원본 그대로 올리기
          </Button>
        ) : (
          <Button size="sm" disabled={!natural || busy} onClick={() => void apply()}>
            {busy ? "자르는 중…" : "이 영역으로"}
          </Button>
        )}
      </div>
    </Dialog>
  );
}

/**
 * 화면에서 보이던 그대로를 그려 낸다. 자를 자리는 `lib/crop-rect` 가 정하고,
 * 여기서는 캔버스에 옮기는 일만 한다.
 */
async function cutOut(
  image: HTMLImageElement,
  {
    frame,
    offset,
    scale,
    name,
  }: {
    frame: { width: number; height: number };
    offset: Point;
    scale: number;
    name: string;
  },
): Promise<File | null> {
  const natural = { width: image.naturalWidth, height: image.naturalHeight };
  const rect = cropRect({ natural, frame, offset, scale });
  const size = outputSize(rect, MAX_OUTPUT);

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, size.width, size.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, OUTPUT_TYPE, OUTPUT_QUALITY),
  );
  if (!blob) return null;
  // webp 를 못 만드는 브라우저는 png 로 준다. 어느 쪽이든 서버 허용 형식이라 그대로 쓴다.
  const type = blob.type || "image/png";
  return new File([blob], renameTo(name, type), { type });
}

function renameTo(name: string, type: string): string {
  const stem = name.replace(/\.[^.]+$/, "") || "photo";
  return `${stem}.${type === "image/webp" ? "webp" : "png"}`;
}
