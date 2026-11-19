"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MATCH_INTENT_KIND_LABELS, type MatchIntentKind } from "@bolsaram/schemas";
import { Button } from "@/components/ui/button";
import { ProfileCode } from "@/components/ui/marks";
import { Panel, Thumb } from "@/components/host/surface";
import { apiPost } from "@/lib/api-client";
import { formatWhen } from "@/lib/dates";

type Party = {
  id: string;
  code: string;
  name: string | null;
  imageUrl: string | null;
  birthYear: number;
} | null;

export type HostIntentItem = {
  id: string;
  kind: MatchIntentKind;
  message: string | null;
  createdAt: string;
  from: Party;
  to: Party;
};

export type HostDeclinedIntentItem = HostIntentItem & {
  declinedAt: string;
  declineReason: string | null;
};

/** 승인하면 무슨 일이 일어나는지 한 문장으로 말한다. 되돌릴 수 없는 것부터 분명히. */
const EFFECT: Record<MatchIntentKind, string> = {
  SEND: "승인하면 상대에게 신청이 전달됩니다. 그전까지 상대는 아무것도 모릅니다.",
  ACCEPT: "승인하면 두 사람이 연결되고 서로의 이름·연락 방법이 공개됩니다.",
  REJECT: "승인하면 서로 목록에서 빠지고 다시 신청할 수 없습니다.",
  CANCEL: "승인하면 이 신청이 취소로 닫힙니다.",
};

/**
 * 멤버가 낸 요청을 확인하는 큐 (0026).
 *
 * 볼사람에서 멤버가 누르는 것은 결정이 아니라 요청이다. 여기서 주선자가 확인해야
 * 상대에게 전달되거나 연결된다 — 그래서 신청 목록보다 위에 둔다.
 */
export function HostIntentQueue({ items }: { items: HostIntentItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) return null;

  async function decide(id: string, action: "approve" | "decline") {
    setBusy(true);
    setError(null);
    const result = await apiPost(`/api/admin/match-intents/${id}/${action}`);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <Panel
      title={`확인을 기다리는 요청 ${items.length}건`}
      className="mb-5 border-[var(--color-rose-200)]"
    >
      <p className="mb-3.5 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
        멤버가 누른 것은 아직 상대에게 가지 않았습니다. 확인하면 그때 전달됩니다. 보고 있는
        모임과 상관없이 맡은 분들의 요청을 모두 보여줍니다. 보류한 요청은 아래 「보류한
        요청」에서 다시 되돌릴 수 있습니다.
      </p>

      {error ? <p className="mb-3 text-[13px] text-[var(--color-danger)]">{error}</p> : null}

      <ul className="stagger flex flex-col gap-2.5">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-[12px] border border-[var(--surface-border)] px-3.5 py-3"
          >
            <div className="flex flex-wrap items-center gap-3">
              <Who party={item.from} />
              <span className="shrink-0 rounded-[var(--radius-pill)] bg-[var(--color-rose-100)] px-2.5 py-1 text-[12px] text-[var(--color-burgundy-800)]">
                {MATCH_INTENT_KIND_LABELS[item.kind]}
              </span>
              <Who party={item.to} />
              <span className="ml-auto text-[12px] text-[var(--surface-text-muted)]">
                {formatWhen(item.createdAt)}
              </span>
            </div>

            {item.message ? (
              <p className="mt-2.5 rounded-[10px] bg-[var(--color-ivory-100)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--color-ink-700)]">
                “{item.message}”
              </p>
            ) : null}

            <p className="mt-2.5 text-[12px] leading-relaxed text-[var(--surface-text-muted)]">
              {EFFECT[item.kind]}
            </p>

            <div className="mt-2.5 flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => void decide(item.id, "approve")}>
                확인하고 전달
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void decide(item.id, "decline")}
              >
                보류
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * 보류한 요청. 큐에서 빠진 요청이 어디 갔는지 보이게 하고, 되돌릴 수 있게 한다.
 *
 * 보류는 「지금은 아니다」라서 되돌릴 수 있다(0030). 되돌리면 확인 대기로 돌아갈 뿐
 * 곧바로 전달하지 않는다 — 전달은 위 큐의 「확인하고 전달」 한 곳에서만 한다.
 * 일감이 아니라 보관함이므로 접어 둔다.
 */
export function HostDeclinedIntents({ items }: { items: HostDeclinedIntentItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) return null;

  async function reopen(id: string) {
    setBusy(true);
    setError(null);
    const result = await apiPost(`/api/admin/match-intents/${id}/reopen`);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <details className="group animate-enter mb-5 rounded-[var(--radius-card)] border border-[var(--surface-border)] bg-[var(--surface-card)] shadow-[var(--shadow-card)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
        <h2 className="display text-[15px] text-[var(--surface-text)]">
          보류한 요청 {items.length}건
        </h2>
        <span
          aria-hidden
          className="text-[12px] text-[var(--surface-text-muted)] transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>

      <div className="border-t border-[var(--surface-border)] p-5">
        <p className="mb-3.5 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
          보류한 요청은 상대에게 전달되지 않았고, 요청한 멤버의 목록에서 그 상대가 빠져
          있습니다. 되돌리면 위 확인 대기로 돌아가고 상대도 다시 보입니다. 전달은 되돌린 뒤
          「확인하고 전달」을 눌러야 합니다.
        </p>

        {error ? <p className="mb-3 text-[13px] text-[var(--color-danger)]">{error}</p> : null}

        <ul className="flex flex-col gap-2.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-[12px] border border-[var(--surface-border)] px-3.5 py-3"
            >
              <div className="flex flex-wrap items-center gap-3">
                <Who party={item.from} />
                <span className="shrink-0 rounded-[var(--radius-pill)] bg-[var(--surface-muted)] px-2.5 py-1 text-[12px] text-[var(--surface-text-muted)]">
                  {MATCH_INTENT_KIND_LABELS[item.kind]}
                </span>
                <Who party={item.to} />
                <span className="ml-auto text-[12px] text-[var(--surface-text-muted)]">
                  보류 {formatWhen(item.declinedAt)}
                </span>
              </div>

              {item.message ? (
                <p className="mt-2.5 rounded-[10px] bg-[var(--color-ivory-100)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--color-ink-700)]">
                  “{item.message}”
                </p>
              ) : null}

              {item.declineReason ? (
                <p className="mt-2.5 text-[12px] leading-relaxed text-[var(--surface-text-muted)]">
                  보류 사유: {item.declineReason}
                </p>
              ) : null}

              <div className="mt-2.5 flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void reopen(item.id)}
                >
                  확인 대기로 되돌리기
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function Who({ party }: { party: Party }) {
  if (!party) {
    return <span className="text-[13px] text-[var(--surface-text-muted)]">삭제된 프로필</span>;
  }
  return (
    <span className="flex min-w-0 shrink-0 items-center gap-2">
      <Thumb
        url={party.imageUrl}
        profileId={party.id}
        size="sm"
        label={`${party.code} 사진 크게 보기`}
      />
      {/* 사진은 크게 보기라 링크 밖에 둔다. 번호·생년 쪽이 상세로 간다. */}
      <Link
        href={`/profiles/${party.id}`}
        className="min-w-0 transition-opacity hover:opacity-80"
      >
        <span className="display block text-[14px] text-[var(--surface-text)]">
          <ProfileCode code={party.code} />
        </span>
        <span className="block truncate text-[11.5px] text-[var(--surface-text-muted)]">
          {[party.name, `${party.birthYear}년생`].filter(Boolean).join(" · ")}
        </span>
      </Link>
    </span>
  );
}
