"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/api-client";

/**
 * 로그아웃.
 *
 * 회원은 스스로 다시 들어올 수 없다 — 주선자가 새 초대 링크를 발급해야 한다.
 * 되돌릴 수 없는 동작이라 한 번 확인하고, 무엇이 필요해지는지 먼저 알려준다.
 */
export function LogoutButton({ needsInviteAgain }: { needsInviteAgain: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!asking) {
    return (
      <Button variant="secondary" onClick={() => setAsking(true)}>
        로그아웃
      </Button>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--surface-border)] bg-white p-4">
      <p className="text-[13px] leading-relaxed text-[var(--color-ink-700)]">
        {needsInviteAgain
          ? "로그아웃하면 다시 들어오려면 주선자에게 새 초대 링크나 입장코드를 요청해야 합니다."
          : "로그아웃하면 이 기기에서 나갑니다. 이메일과 비밀번호로 다시 로그인할 수 있습니다."}
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => {
            void (async () => {
              setBusy(true);
              await apiPost("/api/auth/logout");
              // 실패하더라도 세션 쿠키가 남을 수 있으니 그대로 첫 화면으로 보낸다.
              router.replace("/");
              router.refresh();
            })();
          }}
        >
          {busy ? "나가는 중…" : "로그아웃"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setAsking(false)}>
          취소
        </Button>
      </div>
    </div>
  );
}
