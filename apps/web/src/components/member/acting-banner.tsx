"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiDelete } from "@/lib/api-client";

/**
 * 대행 중임을 알리는 띠.
 *
 * 주선자가 자기 폰으로 회원 화면을 보고 있다는 사실이 **항상 보여야** 한다 —
 * 여기서 누르는 것은 그 회원의 이름으로 남는다. 화면 위쪽은 각 페이지의 sticky
 * 헤더가 쓰므로 하단 탭 바로 위에 고정한다.
 */
export function ActingBanner({ code }: { code: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <div
      className="fixed inset-x-0 z-40 border-t border-[var(--color-burgundy-700)] bg-[var(--color-burgundy-800)] px-4 py-2.5"
      style={{ bottom: "calc(64px + env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-white">
          <span className="display text-[14px]">{code}</span> 님을 대신해 보는 중입니다.
          <span className="ml-1.5 text-white/70">누르는 것은 이 분의 이름으로 남습니다.</span>
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void apiDelete("/api/admin/acting").then(() => {
              router.replace("/home");
              router.refresh();
            });
          }}
          className="shrink-0 rounded-[var(--radius-pill)] bg-white/15 px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-white/25 disabled:opacity-60"
        >
          {busy ? "돌아가는 중…" : "주선자로 돌아가기"}
        </button>
      </div>
    </div>
  );
}
