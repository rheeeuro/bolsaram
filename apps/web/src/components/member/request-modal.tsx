"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { apiPost } from "@/lib/api-client";

/**
 * 소개 신청 모달 (UI 컨셉 05).
 * 신청 순간은 감성적으로 — 다만 하트 남발이나 swipe 없이 절제된 확인 한 단계로 끝낸다.
 */
export function RequestModal({
  open,
  code,
  profileId,
  onClose,
  onSent,
}: {
  open: boolean;
  code: string;
  profileId: string;
  onClose: () => void;
  onSent: (pending: boolean) => void;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="animate-fade absolute inset-0 bg-[var(--color-ink-900)]/45"
      />

      <div className="animate-rise relative w-full max-w-sm rounded-[var(--radius-sheet)] bg-white p-6 text-center shadow-[var(--shadow-lift)]">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[var(--color-rose-100)]">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="m21 3-9 18-2.2-7.8L2 11l19-8Z"
              stroke="var(--color-rose-500)"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h2 className="display mt-5 text-[19px] leading-snug text-[var(--color-ink-900)]">
          {code}에게
          <br />
          마음을 보내시겠어요?
        </h2>
        <p className="mt-2.5 text-[13px] leading-relaxed text-[var(--color-ink-600)]">
          주선자가 확인한 뒤 상대방에게 전달됩니다.
        </p>

        <div className="mt-5 text-left">
          <Textarea
            placeholder="짧은 인사를 남겨보세요 (선택)"
            maxLength={200}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="min-h-20 text-[13.5px]"
          />
        </div>

        {error ? <p className="mt-3 text-[13px] text-[var(--color-danger)]">{error}</p> : null}

        <div className="mt-5 flex flex-col gap-2">
          <Button
            size="lg"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true);
                setError(null);
                const result = await apiPost<{ pending: boolean }>(
                  "/api/match-requests",
                  {
                    targetProfileId: profileId,
                    ...(message.trim() ? { message: message.trim() } : {}),
                  },
                );
                setBusy(false);
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                // 주선자가 대행 중이면 그 자리에서 전달된다(pending=false).
                onSent(result.data.pending);
              })();
            }}
          >
            {busy ? "보내는 중…" : "주선자에게 보내기"}
          </Button>
          <Button variant="ghost" size="lg" onClick={onClose} disabled={busy}>
            아직 고민할게요
          </Button>
        </div>
      </div>
    </div>
  );
}
