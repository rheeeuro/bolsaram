"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/api-client";

/**
 * 초대 링크 진입 버튼.
 *
 * 로그인 화면을 거치지 않는다 — 이 버튼이 곧 로그인이다. 링크를 소비하면 세션이
 * 생기고, 처음이면 회원 계정도 함께 만들어진다.
 */
export function ClaimForm({ token, alreadyLinked }: { token: string; alreadyLinked: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <Button
        size="lg"
        disabled={busy}
        onClick={() => {
          void (async () => {
            setBusy(true);
            setError(null);
            const result = await apiPost<{ firstTime: boolean }>("/api/claim", {
              token: decodeURIComponent(token),
            });
            setBusy(false);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            // 처음이면 내 프로필을 확인하게, 재로그인이면 바로 탐색으로 보낸다.
            router.replace(result.data.firstTime ? "/me" : "/discover");
          })();
        }}
      >
        {busy ? "들어가는 중…" : alreadyLinked ? "볼사람 시작하기" : "내 프로필로 시작하기"}
      </Button>
      {error ? <p className="text-[13px] text-[var(--color-danger)]">{error}</p> : null}
    </div>
  );
}
