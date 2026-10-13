"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import {
  defaultEnhanceOptions,
  enhanceTrace,
  type EnhanceOptions,
} from "@/lib/trace-enhance";
import { cn } from "@/lib/cn";
import { apiGet } from "@/lib/api-client";
import { parseTraceCode } from "@/lib/viewer-code";

/** 판독에 쓰는 긴 변의 한계. 이보다 크면 줄여서 다룬다 — 줄이면 잡음이 줄어 오히려 또렷하다. */
const MAX_SIDE = 2400;

type Loaded = { width: number; height: number; pixels: ImageData };

/**
 * 캡처본 확인 — 유출된 사진에서 숨은 워터마크 층을 드러낸다.
 *
 * 사진은 이 브라우저 안에서만 다룬다. 서버로 올리지 않으므로 유출본이 볼사람 저장소에
 * 남지 않는다. 고르기·붙여넣기(Ctrl+V)·끌어 놓기를 모두 받는다.
 */
export function TraceReader() {
  const inputId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [options, setOptions] = useState<EnhanceOptions | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [code, setCode] = useState("");

  const open = useCallback(async (file: File) => {
    setError(null);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      const work = document.createElement("canvas");
      work.width = width;
      work.height = height;
      const context = work.getContext("2d");
      if (!context) throw new Error("canvas");
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      setLoaded({ width, height, pixels: context.getImageData(0, 0, width, height) });
      setOptions(defaultEnhanceOptions(width, height));
      setShowOriginal(false);
      setZoomed(false);
    } catch {
      setError("이 파일은 열 수 없습니다. 캡처한 사진(PNG·JPEG)을 골라주세요.");
    }
  }, []);

  // PC 에서는 캡처하자마자 붙여넣는 경우가 많다.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) void open(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open]);

  // 슬라이더를 끄는 동안 매번 다시 계산하지 않게 잠깐 모았다가 그린다.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded || !options) return;
    const timer = window.setTimeout(() => {
      canvas.width = loaded.width;
      canvas.height = loaded.height;
      const context = canvas.getContext("2d");
      if (!context) return;
      if (showOriginal) {
        context.putImageData(loaded.pixels, 0, 0);
        return;
      }
      const out = enhanceTrace(loaded.pixels.data, loaded.width, loaded.height, options);
      context.putImageData(new ImageData(out, loaded.width, loaded.height), 0, 0);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [loaded, options, showOriginal]);

  const parsed = parseTraceCode(code);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <section
        className={cn(
          "rounded-[var(--radius-card)] border bg-[var(--surface-card)] shadow-[var(--shadow-card)]",
          dragging
            ? "border-[var(--color-rose-500)]"
            : "border-[var(--surface-border)]",
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void open(file);
        }}
      >
        {loaded ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--surface-border)] px-4 py-3">
              <Button
                size="sm"
                variant={showOriginal ? "secondary" : "primary"}
                onClick={() => setShowOriginal(false)}
              >
                드러낸 사진
              </Button>
              <Button
                size="sm"
                variant={showOriginal ? "primary" : "secondary"}
                onClick={() => setShowOriginal(true)}
              >
                원본
              </Button>
              <span className="ml-auto text-[12px] text-[var(--surface-text-muted)]">
                사진을 누르면 {zoomed ? "화면에 맞춥니다" : "원래 크기로 봅니다"}
              </span>
            </div>
            <div className={cn("bg-[var(--surface-muted)]", zoomed ? "max-h-[75vh] overflow-auto" : "")}>
              <canvas
                ref={canvasRef}
                onClick={() => setZoomed((z) => !z)}
                className={cn(
                  "mx-auto block",
                  zoomed ? "max-w-none cursor-zoom-out" : "h-auto max-h-[75vh] max-w-full cursor-zoom-in",
                )}
              />
            </div>
          </>
        ) : (
          <label
            htmlFor={inputId}
            className="flex min-h-72 cursor-pointer flex-col items-center justify-center gap-2 p-8 text-center"
          >
            <span className="display text-[17px] text-[var(--surface-text)]">
              캡처본을 골라주세요
            </span>
            <span className="max-w-sm text-[13px] leading-relaxed text-[var(--surface-text-muted)]">
              여기로 끌어 놓거나, PC 에서는 Ctrl+V 로 붙여넣어도 됩니다.
              사진은 이 브라우저 안에서만 다루고 서버로 올라가지 않습니다.
            </span>
            <span className={buttonClasses({ size: "sm", className: "mt-3" })}>사진 고르기</span>
          </label>
        )}
        <input
          id={inputId}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void open(file);
          }}
        />
      </section>

      <aside className="flex flex-col gap-4">
        {error ? (
          <p className="rounded-xl bg-[var(--color-danger)]/8 px-4 py-3 text-[13px] text-[var(--color-danger)]">
            {error}
          </p>
        ) : null}

        {loaded && options ? (
          <div className="rounded-[var(--radius-card)] border border-[var(--surface-border)] bg-[var(--surface-card)] p-4">
            <Slider
              label="강도"
              hint="글자가 흐리면 올립니다"
              min={4}
              max={48}
              value={options.gain}
              onChange={(gain) => setOptions({ ...options, gain })}
            />
            <Slider
              label="번짐"
              hint="글자 안이 비면 올리고, 얼룩이 많으면 내립니다"
              min={2}
              max={60}
              value={options.radius}
              onChange={(radius) => setOptions({ ...options, radius })}
            />
            <label
              htmlFor={inputId}
              className={buttonClasses({ size: "sm", variant: "secondary", className: "mt-1 w-full cursor-pointer" })}
            >
              다른 사진
            </label>
          </div>
        ) : null}

        <div className="rounded-[var(--radius-card)] border border-[var(--surface-border)] bg-[var(--surface-card)] p-4 text-[13px] leading-relaxed text-[var(--surface-text-muted)]">
          <p className="display mb-2 text-[14px] text-[var(--surface-text)]">무엇을 찾나요</p>
          <p>
            비스듬히 반복되는 <b className="text-[var(--surface-text)]">No.17 261013</b> 같은 글자입니다.
            17번 멤버가 2026년 10월 13일에 본 사진이라는 뜻입니다.
          </p>
          <p className="mt-2">
            한 줄이 뭉개져도 여러 줄을 맞춰 읽으면 됩니다. 원본에 옅게 보이는{" "}
            <b className="text-[var(--surface-text)]">BOLSARAM No.17 26.10.13</b> 도 같은 뜻입니다.
          </p>
          <p className="mt-2">
            <b className="text-[var(--surface-text)]">H-8F3A2C</b> 처럼 H 로 시작하면 주선자 화면에서
            본 사진입니다.
          </p>
          <CodeLookup code={code} onChange={setCode} parsed={parsed} />
        </div>
      </aside>
    </div>
  );
}

function Slider({
  label,
  hint,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[13px] font-medium text-[var(--surface-text)]">
          {label}
        </label>
        <span className="text-[12px] tabular-nums text-[var(--surface-text-muted)]">{value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1.5 w-full accent-[var(--color-rose-600)]"
      />
      <p className="text-[11.5px] text-[var(--surface-text-muted)]">{hint}</p>
    </div>
  );
}

type HostMatch = { displayName: string | null; isSelf: boolean };

/** 읽은 표기를 넣으면 누구인지 알려준다. 멤버는 멤버 찾기로, 주선자는 이름으로. */
function CodeLookup({
  code,
  onChange,
  parsed,
}: {
  code: string;
  onChange: (value: string) => void;
  parsed: ReturnType<typeof parseTraceCode>;
}) {
  const [hosts, setHosts] = useState<{ prefix: string; list: HostMatch[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookupHost(prefix: string) {
    setBusy(true);
    setError(null);
    const result = await apiGet<{ hosts: HostMatch[] }>(`/api/admin/trace?host=${prefix}`);
    setBusy(false);
    if (result.ok) setHosts({ prefix, list: result.data.hosts });
    else setError(result.message);
  }

  const shown = parsed?.kind === "host" && hosts?.prefix === parsed.prefix ? hosts.list : null;

  return (
    <div className="mt-4">
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(event) => onChange(event.target.value)}
          placeholder="읽은 표기 (17, H-8F3A2C)"
          aria-label="읽은 표기"
          className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--surface-border)] bg-white px-3 text-[14px]"
        />
        {parsed?.kind === "member" ? (
          <Link
            href={`/profiles?q=${parsed.publicCode}`}
            className={buttonClasses({ size: "sm", className: "h-9" })}
          >
            멤버 찾기
          </Link>
        ) : parsed?.kind === "host" ? (
          <Button size="sm" className="h-9" disabled={busy} onClick={() => lookupHost(parsed.prefix)}>
            누구인지
          </Button>
        ) : (
          <span className={buttonClasses({ size: "sm", className: "h-9 opacity-60" })} aria-disabled>
            찾기
          </span>
        )}
      </div>
      {error ? <p className="mt-2 text-[12.5px] text-[var(--color-danger)]">{error}</p> : null}
      {shown ? (
        <p className="mt-2 text-[12.5px] text-[var(--surface-text)]">
          {shown.length === 0
            ? "같은 모임 주선자가 아닙니다. 이 표기를 볼사람 운영자(rheeeuro@gmail.com)에게 알려주세요."
            : shown
                .map((h) => (h.isSelf ? "나 (내 계정)" : `${h.displayName ?? "이름 없음"} 님 — 같은 모임 주선자`))
                .join(", ")}
        </p>
      ) : null}
    </div>
  );
}
