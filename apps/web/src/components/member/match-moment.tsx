"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * 감정 구간 연출 (UI 컨셉 06). 유일하게 긴 모션(--duration-emotive)을 쓴다.
 *
 * 두 번 나타난다 — 마음을 보낸 직후와, 받은 마음을 수락한 직후.
 * 컨셉의 "매칭 성공"은 뒤쪽이므로 문구로 단계를 정확히 갈라 말한다.
 * 방송식 "IT'S A MATCH" 대신 한글 문장을 쓴다(설계문서 §13).
 */
export type MomentVariant = "sent" | "matched";

const COPY: Record<MomentVariant, { headline: [string, string]; body: [string, string] }> = {
  sent: {
    headline: ["마음을", "보냈습니다"],
    body: ["상대방이 수락하면", "서로의 연락 방법이 공개돼요."],
  },
  matched: {
    headline: ["서로의 마음이", "닿았습니다"],
    body: ["이제 서로의 이름과", "연락 방법을 볼 수 있어요."],
  },
};

export function MatchMoment({
  open,
  variant = "sent",
  onClose,
}: {
  open: boolean;
  variant?: MomentVariant;
  onClose: () => void;
}) {
  // ESC 로도 닫을 수 있게 한다.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const copy = COPY[variant];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center px-8 text-center"
      style={{
        background:
          "radial-gradient(90% 60% at 50% 40%, var(--color-burgundy-800) 0%, var(--color-ink-900) 100%)",
      }}
    >
      <div className="animate-rise">
        <p className="display text-[34px] leading-tight tracking-wide text-[var(--color-ivory-100)]">
          {copy.headline[0]}
          <br />
          {copy.headline[1]}
        </p>

        <svg
          className="mx-auto my-8"
          width="72"
          height="64"
          viewBox="0 0 72 64"
          fill="none"
          aria-hidden
        >
          <path
            d="M36 57S6 40 6 22.5A15 15 0 0 1 36 15a15 15 0 0 1 30 7.5C66 40 36 57 36 57Z"
            stroke="var(--color-rose-300)"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>

        <p className="text-[14px] leading-relaxed text-[var(--color-ivory-300)]">
          {copy.body[0]}
          <br />
          {copy.body[1]}
        </p>
      </div>

      <Button
        variant="secondary"
        size="lg"
        className="animate-fade mt-12 w-full max-w-64"
        onClick={onClose}
      >
        확인했어요
      </Button>
    </div>
  );
}
