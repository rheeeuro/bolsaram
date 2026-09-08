"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { apiDelete, apiPost } from "@/lib/api-client";

/**
 * 숨기기 / 숨김 해제 (마이그레이션 0023).
 *
 * 액션 바에 넣지 않고 본문 끝의 조용한 텍스트 버튼으로 둔다 — 「마음 보내기」와 나란히
 * 두면 실수로 누르기 쉽고, 신청 화면의 무게가 흐트러진다.
 *
 * 숨기면 서로 안 보이므로 한 번 확인한다. 되돌릴 수 있다는 것도 함께 알린다 —
 * 되돌리는 곳을 모르면 확인 문구가 협박처럼 읽힌다.
 */
export function HideAction({
  profileId,
  code,
  hidden,
  onChanged,
}: {
  profileId: string;
  code: string;
  /** 내가 이 사람을 숨겼는가. 상대가 나를 숨긴 경우는 여기로 오지 않는다. */
  hidden: boolean;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = (next: boolean) => {
    void (async () => {
      setBusy(true);
      setError(null);
      const result = next
        ? await apiPost("/api/hides", { profileId })
        : await apiDelete("/api/hides", { profileId });
      setBusy(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setConfirming(false);
      onChanged();
    })();
  };

  if (hidden) {
    return (
      <div className="mx-auto mt-10 max-w-2xl px-5">
        <p className="rounded-xl bg-[var(--color-ivory-100)] px-4 py-3 text-[12.5px] leading-relaxed text-[var(--color-ink-700)]">
          숨긴 분입니다. 서로 탐색 목록에 보이지 않고 마음도 보낼 수 없습니다.
        </p>
        {error ? (
          <p className="mt-2 text-[13px] text-[var(--color-danger)]">{error}</p>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => send(false)}
          className="mt-3 text-[13px] text-[var(--color-ink-600)] underline disabled:opacity-50"
        >
          {busy ? "해제 중…" : "숨김 해제"}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="mx-auto mt-10 max-w-2xl px-5">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-[13px] text-[var(--color-ink-500)] underline"
        >
          이 분 숨기기
        </button>
      </div>

      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <button
            type="button"
            aria-label="닫기"
            onClick={() => setConfirming(false)}
            className="animate-fade absolute inset-0 bg-[var(--color-ink-900)]/45"
          />
          <div className="animate-rise relative w-full max-w-sm rounded-[var(--radius-sheet)] bg-white p-6 shadow-[var(--shadow-lift)]">
            <h2 className="display text-[18px] leading-snug text-[var(--color-ink-900)]">
              {code}을 숨기시겠어요?
            </h2>
            <p className="mt-2.5 text-[13px] leading-relaxed text-[var(--color-ink-600)]">
              탐색 목록에서 서로 보이지 않고, 서로 마음을 보낼 수 없게 됩니다. 상대에게는
              알리지 않습니다. 내 프로필 화면에서 언제든 해제할 수 있습니다.
            </p>

            {error ? (
              <p className="mt-3 text-[13px] text-[var(--color-danger)]">{error}</p>
            ) : null}

            <div className="mt-5 flex flex-col gap-2">
              <Button size="lg" disabled={busy} onClick={() => send(true)}>
                {busy ? "숨기는 중…" : "숨기기"}
              </Button>
              <Button
                variant="ghost"
                size="lg"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                취소
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
