"use client";

import { useState } from "react";
import { Input } from "./field";

/**
 * 비밀번호 입력 + 보기 토글.
 *
 * 주선자는 모바일에서도 로그인한다 — 오타를 확인할 방법이 없으면 시도 제한(15분 5회)에
 * 걸린다. 기본은 가려진 상태이고 토글은 이 기기에서만 유효하다.
 */
export function PasswordInput({
  value,
  onChange,
  autoComplete,
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pr-16"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg px-2.5 py-1.5 text-[12.5px] text-[var(--color-ink-600)] transition-colors hover:bg-[var(--color-ivory-100)]"
      >
        {visible ? "가리기" : "보기"}
      </button>
    </div>
  );
}
