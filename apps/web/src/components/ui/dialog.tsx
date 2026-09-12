"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/**
 * 화면을 덮는 모든 것의 공용 껍데기.
 *
 * 네 곳(소개 신청·숨기기 확인·조건 시트·감정 연출)이 각자 `fixed inset-0` 을 그리면서
 * 시맨틱과 키보드 처리가 제각각이었다. 여기 한 곳에서 보장한다.
 *
 *   - `role="dialog"` + `aria-modal` + 접근명
 *   - 열 때 안으로 포커스를 옮기고, 닫을 때 누른 자리로 되돌린다
 *   - Tab 이 껍데기 안에서만 돈다
 *   - ESC 로 닫힌다
 *   - 열려 있는 동안 배경이 스크롤되지 않는다
 *
 * 배경막은 클릭만 받는 장식이라 버튼이 아니라 `div` 다 — 화면 전체를 덮는 버튼을
 * 탭 순서에 넣으면 키보드 사용자가 먼저 「닫기」를 밟고 지나간다. 닫는 길은
 * ESC 와 각 화면이 놓은 취소 버튼이다.
 *
 * 그리는 자리는 부르는 곳이 아니라 **표면 루트**(`.host-surface` / `.member-surface`)다.
 * `backdrop-filter` 가 걸린 조상(예: sticky 헤더) 안에서 `position: fixed` 는 뷰포트가
 * 아니라 그 조상을 기준으로 잡혀 화면 밖으로 밀려난다. 표면 루트로 올리면 그 영향을
 * 받지 않으면서 `--surface-*` 변수는 그대로 물려받는다.
 */

/** 덮개를 붙일 자리. 둘 다 없으면 body 로 떨어진다. */
const SURFACE_ROOT = ".host-surface, .member-surface";

type Variant = "center" | "sheet" | "full";

const WRAP: Record<Variant, string> = {
  center: "z-50 flex items-center justify-center px-6",
  sheet: "z-40 flex items-end justify-center",
  full: "z-50 flex flex-col items-center justify-center px-8 text-center",
};

const PANEL: Record<Variant, string> = {
  center:
    "animate-rise relative w-full max-w-sm rounded-[var(--radius-sheet)] bg-white p-6 shadow-[var(--shadow-lift)]",
  sheet:
    "animate-sheet relative flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-[var(--radius-sheet)] bg-white shadow-[var(--shadow-sheet)]",
  full: "relative flex w-full flex-col items-center",
};

/** 포커스를 받을 수 있는 것들. 화면에서 감춘 것(`hidden`)은 아래에서 걸러낸다. */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  label,
  variant = "center",
  backdrop = true,
  className,
  style,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** 접근명. 보이는 제목에 줄바꿈이 들어가는 곳이 있어 문자열로 따로 받는다. */
  label: string;
  variant?: Variant;
  /** 연출 화면처럼 스스로가 바탕인 경우에는 끈다. */
  backdrop?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [mount, setMount] = useState<HTMLElement | null>(null);

  // 부르는 자리에 남겨 둔 표식에서 표면 루트를 찾는다. 마운트 뒤에야 DOM 이 있으므로
  // 첫 렌더에는 아무것도 그리지 않는다 — 덮개는 늘 사용자가 눌러야 열린다.
  useEffect(() => {
    const surface = anchorRef.current?.closest<HTMLElement>(SURFACE_ROOT);
    setMount(surface ?? document.body);
  }, []);

  // 부르는 쪽이 인라인 화살표를 넘기므로 의존성에 그대로 넣으면 렌더마다 효과가
  // 다시 돈다 — 포커스를 계속 뺏기고 스크롤 락이 풀렸다 걸린다.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetWidth > 0 || el.offsetHeight > 0,
      );

    (focusables()[0] ?? panel).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = list[0]!;
      const last = list[list.length - 1]!;
      // 껍데기 밖으로 나가려는 순간에만 붙잡는다.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    // 배경 스크롤 락. 스크롤바가 사라지며 생기는 폭 변화는 padding 으로 메운다.
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (gap > 0) body.style.paddingRight = `${gap}px`;

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
      // 닫은 뒤에는 열었던 자리로 돌아간다. 그 자리가 사라졌으면 아무것도 하지 않는다.
      if (previous?.isConnected) previous.focus();
    };
    // `mount` 는 첫 렌더 뒤에야 정해진다. 열린 채로 마운트되는 덮개는 그때 비로소
    // 패널이 생기므로, 여기 넣지 않으면 포커스 트랩과 스크롤 락이 걸리지 않는다.
  }, [open, mount]);

  if (!open || !mount) return <span ref={anchorRef} hidden />;

  return createPortal(
    <div className={cn("fixed inset-0", WRAP[variant])} style={style}>
      {backdrop ? (
        <div
          aria-hidden
          onClick={onClose}
          className="animate-fade absolute inset-0 bg-[var(--color-ink-900)]/45"
        />
      ) : null}

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(PANEL[variant], className)}
      >
        {children}
      </div>
    </div>,
    mount,
  );
}

/** 시트 오른쪽 위의 닫기 X. 시트에는 취소 버튼이 따로 없어 이게 유일한 닫는 버튼이다. */
export function DialogClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="닫기"
      className="-mr-2 grid h-11 w-11 place-items-center rounded-full text-[var(--color-ink-600)] transition-colors hover:bg-[var(--surface-muted)]"
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path
          d="m5 5 10 10M15 5 5 15"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
