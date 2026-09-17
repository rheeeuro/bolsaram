"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

/**
 * 누르면 열리는 작은 메뉴.
 *
 * `Dialog` 와 달리 화면을 덮지 않는다 — 누른 자리 옆에 붙어서 한 줄짜리 선택지
 * 서너 개를 내놓고 고르면 사라진다. 모임 이름 옆의 설정 메뉴처럼 「여기서 할 수 있는
 * 일」을 숨겨 두는 자리에 쓴다.
 *
 * 보장하는 것:
 *   - `aria-expanded` · `aria-haspopup` 으로 상태를 읽어 준다
 *   - ESC 와 바깥 클릭으로 닫히고, 닫히면 누른 버튼으로 포커스가 돌아온다
 *   - ↑↓ 로 항목 사이를 옮겨 다닌다
 *   - 항목을 고르면 스스로 닫힌다(`MenuItem` 이 부른다)
 *
 * 포커스를 가두지는 않는다. 메뉴는 선택을 강요하는 자리가 아니라 지나쳐 갈 수 있는
 * 자리이고, Tab 으로 벗어나면 그대로 닫힌다.
 */

const MenuContext = createContext<{ close: () => void } | null>(null);

/** 메뉴 안에서 포커스를 받을 수 있는 것들. */
const ITEMS = '[role="menuitem"]:not([disabled])';

export function Menu({
  label,
  trigger,
  children,
  className,
  panelClassName,
}: {
  /** 접근명. 메뉴가 무엇에 대한 것인지 적는다(예: 「볼사람 강남 설정」). */
  label: string;
  /** 버튼 안에 그릴 것. 상태에 따라 모양이 달라지므로 열림 여부를 받는다. */
  trigger: (open: boolean) => ReactNode;
  children: ReactNode;
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const close = useCallback((focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (!root) return;

    // 열면 첫 항목으로 들어간다. 키보드만 쓰는 사람에게 메뉴가 열렸다는 것이
    // 포커스 이동으로 전달된다.
    root.querySelector<HTMLElement>(ITEMS)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const list = [...root.querySelectorAll<HTMLElement>(ITEMS)];
      if (list.length === 0) return;
      event.preventDefault();
      const here = list.indexOf(document.activeElement as HTMLElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = here < 0 ? 0 : (here + step + list.length) % list.length;
      list[next]?.focus();
    };

    // 바깥을 누르면 닫는다. 이때는 포커스를 되돌리지 않는다 — 사용자가 이미 다른
    // 곳을 눌렀는데 버튼으로 끌어오면 그 클릭을 빼앗는다.
    const onPointerDown = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) close(false);
    };
    // Tab 으로 메뉴 밖으로 나가면 그대로 닫는다.
    const onFocusIn = (event: FocusEvent) => {
      if (!root.contains(event.target as Node)) close(false);
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, [open, close]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left"
      >
        {trigger(open)}
      </button>

      {open ? (
        <MenuContext.Provider value={{ close }}>
          <div
            id={panelId}
            role="menu"
            aria-label={label}
            className={cn(
              "animate-rise absolute left-0 right-0 top-[calc(100%+4px)] z-40 grid gap-0.5",
              "rounded-xl border border-[var(--surface-border)] bg-white p-1.5",
              "shadow-[var(--shadow-lift)]",
              panelClassName,
            )}
          >
            {children}
          </div>
        </MenuContext.Provider>
      ) : null}
    </div>
  );
}

/**
 * 메뉴 한 줄. `href` 를 주면 링크, `onSelect` 를 주면 버튼이다.
 *
 * 무엇이든 고르면 메뉴를 닫는다 — 링크는 화면이 바뀌는 사이 메뉴가 남아 있지 않게,
 * 버튼은 창을 띄우거나 확인을 물으러 가기 전에 자리를 비우게.
 */
export function MenuItem({
  href,
  onSelect,
  danger,
  children,
}: {
  href?: string;
  onSelect?: () => void;
  /** 되돌리기 어려운 것(나가기·폐쇄). 색으로만 구분하지 않게 문구도 동사로 쓴다. */
  danger?: boolean;
  children: ReactNode;
}) {
  const menu = useContext(MenuContext);
  const className = cn(
    "flex min-h-9 items-center gap-2 rounded-lg px-2.5 text-[12.5px] transition-colors",
    danger
      ? "text-[var(--color-rose-600)] hover:bg-[var(--color-rose-100)]"
      : "text-[var(--color-ink-700)] hover:bg-[var(--color-ivory-200)]",
  );

  if (href) {
    return (
      <Link role="menuitem" href={href} className={className} onClick={() => menu?.close()}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      className={className}
      onClick={() => {
        menu?.close();
        onSelect?.();
      }}
    >
      {children}
    </button>
  );
}
