"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/api-client";

/**
 * 로그아웃.
 *
 * 멤버는 받은 초대 링크를 다시 열어야 들어온다. 그 링크가 없으면 주선자에게 다시
 * 받아야 하므로 한 번 확인하고, 무엇이 필요해지는지 먼저 알려준다.
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
          ? "로그아웃하면 이 기기에서 나갑니다. 다시 들어오려면 카카오톡으로 받은 초대 링크를 다시 누르세요. 링크가 없으면 주선자에게 요청하세요."
          : "로그아웃하면 이 기기에서 나갑니다. 카카오나 구글로 다시 로그인할 수 있습니다."}
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
