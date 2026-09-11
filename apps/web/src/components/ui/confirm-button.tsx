"use client";

import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * 되돌릴 수 없는 동작에 한 번 더 묻는다.
 *
 * 모달을 띄우지 않고 제자리에서 문장으로 바꾼다 — 무슨 일이 일어나는지 읽고 누르게
 * 하는 것이 목적이지, 클릭을 한 번 더 받는 것이 목적이 아니다.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  message,
  onConfirm,
  disabled,
  variant = "secondary",
  size = "sm",
}: {
  label: string;
  /** 확인 단계 버튼 문구. 무엇이 일어나는지 동사로 쓴다. */
  confirmLabel: string;
  message: string;
  onConfirm: () => void;
  disabled?: boolean;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <Button size={size} variant={variant} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded-[10px] border border-[var(--color-rose-200)] bg-[var(--color-rose-100)] px-3 py-2">
      <span className="text-[12px] leading-snug text-[var(--color-burgundy-800)]">
        {message}
      </span>
      {/* 확인 단계는 실제로 일이 벌어지는 클릭이다. 먼저 누른 버튼보다 작아지지 않게
          같은 size 를 그대로 넘긴다. */}
      <Button
        size={size}
        variant={variant === "danger" ? "danger" : "primary"}
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button size={size} variant="ghost" disabled={disabled} onClick={() => setAsking(false)}>
        그만두기
      </Button>
    </span>
  );
}
