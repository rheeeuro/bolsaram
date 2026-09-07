"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/api-client";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="secondary"
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
      로그아웃
    </Button>
  );
}
