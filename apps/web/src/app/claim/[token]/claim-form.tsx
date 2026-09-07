"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/api-client";

export function ClaimForm({ token, loggedIn }: { token: string; loggedIn: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loggedIn) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[13px] leading-relaxed text-[var(--color-ink-600)]">
          먼저 초대받은 휴대폰 번호로 로그인해 주세요.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(`/claim/${token}`)}`}
          className="flex h-12 items-center justify-center rounded-xl bg-[var(--color-rose-500)] text-[15px] font-medium text-white"
        >
          로그인하고 계속하기
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        size="lg"
        disabled={busy}
        onClick={() => {
          void (async () => {
            setBusy(true);
            setError(null);
            const result = await apiPost("/api/claim", { token: decodeURIComponent(token) });
            setBusy(false);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            router.replace("/me");
          })();
        }}
      >
        {busy ? "연결 중…" : "내 프로필로 연결하기"}
      </Button>
      {error ? <p className="text-[13px] text-[var(--color-danger)]">{error}</p> : null}
    </div>
  );
}
