"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { MATCH_REQUEST_STATUSES, MATCH_REQUEST_STATUS_LABELS } from "@bolsaram/schemas";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/host/surface";
import { apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { label } from "@/lib/labels";

type Party = {
  id: string;
  code: string;
  name: string | null;
  imageUrl: string | null;
  birthYear: number;
} | null;

export type HostRequestItem = {
  id: string;
  status: string;
  message: string | null;
  requestedAt: string;
  requester: Party;
  target: Party;
};

/**
 * 신청 목록.
 *
 * 표가 아니라 두 사람이 마주 보는 카드로 둔다 — 주선자가 판단하는 단위는 행이 아니라
 * 「누가 누구에게」다. 연결된 건만 rose 로 칠해 눈에 먼저 들어오게 한다.
 */
export function HostRequestList({
  items,
  activeStatus,
}: {
  items: HostRequestItem[];
  activeStatus: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setStatusFilter(status: string) {
    const search = new URLSearchParams(params.toString());
    if (status) search.set("status", status);
    else search.delete("status");
    router.push(`/requests?${search.toString()}`);
  }

  /**
   * 당사자를 대신해 상태를 옮긴다.
   *
   * 회원은 초대 링크로만 세션이 생긴다 — 자기 폰을 쓰지 않거나 30일이 지난 회원은
   * 스스로 누를 수 없다. 그 의사를 주선자가 확인해 여기서 기록한다.
   */
  async function act(id: string, action: "accept" | "reject" | "cancel" | "close") {
    setBusy(true);
    setError(null);
    const result = await apiPost(`/api/admin/match-requests/${id}/${action}`);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className="no-scrollbar -mx-1 mb-5 flex gap-1.5 overflow-x-auto px-1">
        <FilterPill
          label="전체"
          active={activeStatus === ""}
          onClick={() => setStatusFilter("")}
        />
        {MATCH_REQUEST_STATUSES.map((status) => (
          <FilterPill
            key={status}
            label={MATCH_REQUEST_STATUS_LABELS[status]}
            active={activeStatus === status}
            onClick={() => setStatusFilter(status)}
          />
        ))}
      </div>

      {error ? <p className="mb-3 text-[13px] text-[var(--color-danger)]">{error}</p> : null}

      {items.length === 0 ? (
        <Panel>
          <p className="py-12 text-center text-[13.5px] text-[var(--surface-text-muted)]">
            해당하는 신청이 없습니다.
          </p>
        </Panel>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const connected = item.status === "INTRODUCED";
            return (
              <li
                key={item.id}
                className={cn(
                  "rounded-[var(--radius-card)] border bg-[var(--surface-card)] p-4",
                  "shadow-[var(--shadow-card)]",
                  connected
                    ? "border-[var(--color-rose-300)]"
                    : "border-[var(--surface-border)]",
                )}
              >
                <div className="flex flex-wrap items-center gap-4">
                  <PartyCard party={item.requester} />

                  <div className="flex shrink-0 flex-col items-center gap-1.5">
                    {connected ? <Heart /> : <Arrow />}
                    <Badge tone={toneForStatus(item.status)}>
                      {label.matchStatus(item.status)}
                    </Badge>
                  </div>

                  <PartyCard party={item.target} />

                  <div className="ml-auto flex shrink-0 items-center gap-3">
                    <span className="text-[12px] text-[var(--surface-text-muted)]">
                      {new Date(item.requestedAt).toLocaleString("ko-KR", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {connected ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void act(item.id, "close")}
                      >
                        종료
                      </Button>
                    ) : null}
                  </div>
                </div>

                {item.message ? (
                  <p className="mt-3 rounded-[10px] bg-[var(--color-ivory-100)] px-3.5 py-2.5 text-[13px] leading-relaxed text-[var(--color-ink-700)]">
                    “{item.message}”
                  </p>
                ) : null}

                {item.status === "REQUESTED" ? (
                  <OnBehalf
                    busy={busy}
                    target={item.target?.code ?? "상대"}
                    requester={item.requester?.code ?? "신청자"}
                    onAct={(action) => void act(item.id, action)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

type BehalfAction = "accept" | "reject" | "cancel";

/** 되돌릴 수 없는 전이라 한 번 더 묻는다. 특히 수락은 그 자리에서 연락처를 공개한다. */
const BEHALF_CONFIRM: Record<BehalfAction, (p: { requester: string; target: string }) => string> =
  {
    accept: ({ requester, target }) =>
      `${target} 님이 수락했다고 기록할까요? 두 분이 연결되고 ${requester} 님과 서로의 이름·연락 방법이 공개됩니다.`,
    reject: ({ target }) =>
      `${target} 님이 거절했다고 기록할까요? 두 사람은 서로의 목록에서 빠지고 다시 신청할 수 없습니다.`,
    cancel: ({ requester }) =>
      `${requester} 님이 마음을 거뒀다고 기록할까요? 이 신청은 취소로 닫힙니다.`,
  };

const BEHALF_LABELS: Record<BehalfAction, string> = {
  accept: "수락",
  reject: "거절",
  cancel: "신청 취소",
};

/**
 * 당사자를 대신해 처리하는 줄.
 *
 * 회원은 초대 링크로만 세션이 생기므로 자기 폰을 쓰지 않는 분은 직접 누를 수 없다.
 * 주선자가 카카오톡·대면으로 의사를 확인한 뒤 그 답을 여기에 기록한다.
 */
function OnBehalf({
  busy,
  requester,
  target,
  onAct,
}: {
  busy: boolean;
  requester: string;
  target: string;
  onAct: (action: BehalfAction) => void;
}) {
  const [pending, setPending] = useState<BehalfAction | null>(null);

  if (pending) {
    return (
      <div className="mt-3 rounded-[10px] border border-[var(--color-rose-200)] bg-[var(--color-rose-100)] px-3.5 py-3">
        <p className="text-[12.5px] leading-relaxed text-[var(--color-burgundy-800)]">
          {BEHALF_CONFIRM[pending]({ requester, target })}
        </p>
        <div className="mt-2.5 flex gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              onAct(pending);
              setPending(null);
            }}
          >
            {BEHALF_LABELS[pending]}으로 기록
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPending(null)}>
            그만두기
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--surface-border)] pt-3">
      <span className="text-[12px] text-[var(--surface-text-muted)]">
        본인 대신 처리 — 카카오톡·대면으로 확인한 답을 기록합니다
      </span>
      <div className="ml-auto flex gap-2">
        {(["accept", "reject", "cancel"] as const).map((action) => (
          <Button
            key={action}
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => setPending(action)}
          >
            {BEHALF_LABELS[action]}
          </Button>
        ))}
      </div>
    </div>
  );
}

function PartyCard({ party }: { party: Party }) {
  if (!party) {
    return (
      <span className="text-[13px] text-[var(--surface-text-muted)]">삭제된 프로필</span>
    );
  }
  return (
    <Link
      href={`/profiles/${party.id}`}
      className="flex min-w-0 shrink-0 items-center gap-2.5 transition-opacity hover:opacity-80"
    >
      <div className="h-14 w-11 shrink-0 overflow-hidden rounded-[10px] bg-[var(--color-ivory-200)]">
        {party.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={party.imageUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>
      <div className="min-w-0">
        <p className="display text-[15px] text-[var(--surface-text)]">{party.code}</p>
        <p className="truncate text-[12px] text-[var(--surface-text-muted)]">
          {[party.name, `${party.birthYear}년생`].filter(Boolean).join(" · ")}
        </p>
      </div>
    </Link>
  );
}

/** 아직 답을 기다리는 신청. 방향만 조용히 보여준다. */
function Arrow() {
  return (
    <svg width="22" height="12" viewBox="0 0 22 12" fill="none" aria-hidden>
      <path
        d="M1 6h19m0 0-4.5-4.5M20 6l-4.5 4.5"
        stroke="var(--color-ink-400)"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 연결된 건에만 쓴다. 하트를 남발하지 않는다(설계문서 §13). */
function Heart() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M10 16s-6-3.7-6-7.6A3.4 3.4 0 0 1 10 6.3a3.4 3.4 0 0 1 6 2.1C16 12.3 10 16 10 16Z"
        fill="var(--color-rose-500)"
        stroke="var(--color-rose-500)"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FilterPill({
  label: text,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-[var(--radius-pill)] border px-3.5 py-1.5 text-[13px]",
        "transition-colors duration-[var(--duration-quick)]",
        active
          ? "border-[var(--color-rose-600)] bg-[var(--color-rose-600)] text-white"
          : "border-[var(--surface-border)] bg-[var(--surface-card)] text-[var(--surface-text-muted)] hover:border-[var(--color-rose-300)]",
      )}
    >
      {text}
    </button>
  );
}
