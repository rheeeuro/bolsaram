"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * 신청 직후 연출 (UI 컨셉 06).
 * 감정 구간이라 유일하게 긴 모션(--duration-emotive)을 쓴다.
 * 실제 "매칭 성공"은 상대 수락 이후이므로 문구로 단계를 정확히 말한다.
 */
export function MatchMoment({ open, onClose }: { open: boolean; onClose: () => void }) {
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
          마음을
          <br />
          보냈습니다
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
          상대방이 수락하면
          <br />
          주선자가 두 분을 연결해드릴게요.
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
