"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { apiDelete } from "@/lib/api-client";

export type GroupRequestChoice = {
  id: string;
  name: string;
  status: "PENDING" | "REJECTED";
};

/**
 * 모임 목록 아래에 붙는 내 모임 만들기 요청 — 관리자 승인을 기다리는 것과 최근에
 * 승인되지 않은 것.
 *
 * 모임과 같은 자리에 두되 고를 수 없게 흐리게 그린다. 아직 없는 모임이라 들어갈 곳이
 * 없고, 승인되면 같은 자리에 진짜 모임이 나타난다. 사이드바와 모바일 모임 시트가
 * 함께 쓴다.
 */
export function GroupRequestRows({
  requests,
  roomy,
}: {
  requests: GroupRequestChoice[];
  /** 모바일 시트처럼 줄 높이를 넉넉히 쓰는 곳. */
  roomy?: boolean;
}) {
  if (requests.length === 0) return null;
  return (
    <ul aria-label="모임 만들기 요청" className="flex flex-col gap-1">
      {requests.map((request) => (
        <RequestRow key={request.id} request={request} roomy={roomy} />
      ))}
    </ul>
  );
}

function RequestRow({ request, roomy }: { request: GroupRequestChoice; roomy?: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = request.status === "PENDING";

  async function cancel() {
    setBusy(true);
    setError(null);
    const result = await apiDelete(`/api/admin/groups/requests/${request.id}`);
    setBusy(false);
    setAsking(false);
    if (!result.ok) setError(result.message);
    router.refresh();
  }

  return (
    <li
      className={cn(
        "rounded-xl border border-dashed border-[var(--surface-border)] px-3 py-2",
        roomy ? "min-h-14" : "min-h-12",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "flex shrink-0 items-center justify-center rounded-xl bg-[var(--color-ivory-200)] text-[13px] text-[var(--surface-text-muted)]",
            roomy ? "size-10" : "size-9",
          )}
        >
          {pending ? "…" : "×"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-[var(--surface-text-muted)]">
            {request.name}
          </span>
          <span
            className={cn(
              "block text-[11px]",
              pending ? "text-[var(--surface-text-muted)]" : "text-[var(--color-rose-600)]",
            )}
          >
            {pending ? "관리자 승인 대기" : "승인되지 않음"}
          </span>
        </span>
        {pending && !asking ? (
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="shrink-0 rounded-md px-1.5 py-1 text-[11.5px] text-[var(--surface-text-muted)] hover:bg-[var(--color-ivory-200)]"
          >
            취소
          </button>
        ) : null}
      </div>
      {asking ? (
        <div className="mt-2 flex items-center justify-end gap-1.5">
          <span className="mr-auto text-[11.5px] text-[var(--surface-text-muted)]">
            요청을 거둘까요?
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => setAsking(false)}
            className="rounded-md px-2 py-1 text-[11.5px] text-[var(--surface-text-muted)] hover:bg-[var(--color-ivory-200)]"
          >
            아니요
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void cancel()}
            className="rounded-md bg-[var(--color-rose-600)] px-2 py-1 text-[11.5px] text-white disabled:opacity-60"
          >
            {busy ? "거두는 중…" : "거두기"}
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-[11.5px] text-[var(--color-rose-600)]">
          {error}
        </p>
      ) : null}
    </li>
  );
}
