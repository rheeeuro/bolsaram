"use client";

/**
 * 렌더링 중 터진 예외의 마지막 그물.
 * 원인 문자열에 개인정보가 섞일 수 있으므로 화면에 내보내지 않는다.
 */
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("화면 렌더링 실패:", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="member-surface flex min-h-dvh flex-col items-center justify-center bg-[var(--color-ivory-50)] px-8 text-center">
      <p className="kicker">SOMETHING WENT WRONG</p>
      <h1 className="display mt-4 text-[26px] leading-tight text-[var(--color-ink-900)]">
        화면을 열지 못했어요
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-ink-700)]">
        잠시 뒤 다시 시도해 주세요. 계속 이러면 주선자에게 알려주세요.
      </p>
      <Button size="lg" className="mt-8" onClick={reset}>
        다시 시도
      </Button>
    </main>
  );
}
