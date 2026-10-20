"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { MATCH_REQUEST_STATUSES, MATCH_REQUEST_STATUS_LABELS } from "@bolsaram/schemas";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { ProfileCode } from "@/components/ui/marks";
import { PhotoZoom } from "@/components/ui/photo-zoom";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/host/surface";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { CopyField } from "@/components/ui/copy-field";
import { apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { label } from "@/lib/labels";
import { formatWhen } from "@/lib/dates";

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
  /** 받는 쪽이 내 담당이고 답을 기다릴 때만 있다. `joined` 는 초대 링크로 들어온 적이 있는지. */
  notify: { joined: boolean } | null;
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
  signalsUrl,
}: {
  items: HostRequestItem[];
  activeStatus: string;
  /** 받은 시그널 화면의 전체 주소. 알릴 문구에 붙는다. */
  signalsUrl: string;
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
   * 멤버는 초대 링크로만 세션이 생긴다 — 자기 폰을 쓰지 않거나 30일이 지난 멤버는
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
        <ul className="stagger flex flex-col gap-3">
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

                  <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-3">
                    <span className="text-[12px] text-[var(--surface-text-muted)]">
                      {formatWhen(item.requestedAt)}
                    </span>
                    {connected ? (
                      <ConfirmButton
                        label="종료"
                        confirmLabel="종료하기"
                        message="이 연결을 마무리합니다. 이미 공개된 이름과 연락 방법은 그대로 남습니다."
                        disabled={busy}
                        onConfirm={() => void act(item.id, "close")}
                      />
                    ) : null}
                  </div>
                </div>

                {item.message ? (
                  <p className="mt-3 rounded-[10px] bg-[var(--color-ivory-100)] px-3.5 py-2.5 text-[13px] leading-relaxed text-[var(--color-ink-700)]">
                    “{item.message}”
                  </p>
                ) : null}

                {item.notify ? (
                  <NotifyMember
                    joined={item.notify.joined}
                    profileId={item.target?.id ?? null}
                    requester={item.requester?.code ?? "상대"}
                    target={item.target?.code ?? "받는 분"}
                    signalsUrl={signalsUrl}
                  />
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

/**
 * 받는 분에게 알릴 문구.
 *
 * 멤버에게는 알림이 가지 않으므로 받은 신청은 담당 주선자가 카카오톡으로 전한다.
 * 프로필을 밖으로 내보내는 링크는 만들지 않는다 — 문구에는 공개 번호만, 링크는 받은
 * 시그널 화면이라 로그인한 본인만 상대를 본다. 들어온 적 없는 분은 그 화면에 갈 수
 * 없으니 초대 링크를 새로 발급해 같은 화면으로 이어 준다.
 */
function NotifyMember({
  joined,
  profileId,
  requester,
  target,
  signalsUrl,
}: {
  joined: boolean;
  profileId: string | null;
  requester: string;
  target: string;
  signalsUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issueInvite() {
    if (!profileId) return;
    setBusy(true);
    setError(null);
    const result = await apiPost<{ url: string }>("/api/admin/invites", {
      profileId,
      expiresInHours: 72,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const signals = new URL(signalsUrl);
    setInviteUrl(
      `${result.data.url}?next=${encodeURIComponent(signals.pathname + signals.search)}`,
    );
  }

  if (!open) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--surface-border)] pt-3">
        <span className="text-[12px] text-[var(--surface-text-muted)]">
          {target} 님 화면에는 알림이 뜨지 않습니다 — 카카오톡으로 알려 주세요
        </span>
        <Button size="sm" className="ml-auto" onClick={() => setOpen(true)}>
          본인에게 알리기
        </Button>
      </div>
    );
  }

  const link = joined ? signalsUrl : inviteUrl;
  const message = link
    ? [
        `볼사람에서 ${requester} 분이 마음을 보냈어요.`,
        joined
          ? "받은 시그널에서 프로필을 보고 수락이나 거절을 눌러 주세요."
          : "아래 링크로 들어와 프로필을 보고 수락이나 거절을 눌러 주세요.",
        link,
      ].join("\n")
    : null;

  return (
    <div className="mt-3 flex flex-col gap-2.5 rounded-[10px] bg-[var(--color-ivory-100)] p-3">
      {message ? (
        <>
          <CopyField label="카카오톡으로 보낼 문구" value={message} multiline />
          <p className="text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]">
            {joined
              ? "로그인한 본인만 열 수 있는 링크입니다. 로그인이 풀린 분은 처음 받은 초대 링크나 입장코드를 넣으면 이 화면으로 돌아옵니다."
              : "새로 발급한 초대 링크입니다. 72시간 안에 처음 열어야 하고, 한 번 열면 그분의 입장 링크로 계속 쓰입니다."}
          </p>
          {joined ? (
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => setOpen(false)}
            >
              접기
            </Button>
          ) : null}
        </>
      ) : (
        <>
          <p className="text-[12.5px] leading-relaxed text-[var(--color-ink-700)]">
            {target} 님은 아직 볼사람에 들어온 적이 없습니다. 초대 링크를 새로 발급해 문구에
            붙입니다. 전에 보낸 링크가 있다면 더 이상 열리지 않습니다.
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !profileId} onClick={() => void issueInvite()}>
              {busy ? "발급 중…" : "초대 링크 발급"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              그만두기
            </Button>
          </div>
        </>
      )}
      {error ? <p className="text-[12px] text-[var(--color-danger)]">{error}</p> : null}
    </div>
  );
}

type BehalfAction = "accept" | "reject" | "cancel";

/** 되돌릴 수 없는 전이라 한 번 더 묻는다. 특히 수락은 그 자리에서 연락처를 공개한다. */
const BEHALF_CONFIRM: Record<
  BehalfAction,
  (p: { requester: string; target: string }) => string
> = {
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
 * 멤버는 초대 링크로만 세션이 생기므로 자기 폰을 쓰지 않는 분은 직접 누를 수 없다.
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
    return <span className="text-[13px] text-[var(--surface-text-muted)]">삭제된 프로필</span>;
  }
  const box =
    "block h-14 w-11 shrink-0 overflow-hidden rounded-[10px] bg-[var(--color-ivory-200)]";
  // 사진은 크게 보기라 링크 밖에 둔다. 번호·이름 쪽이 상세로 간다.
  return (
    <span className="flex min-w-0 shrink-0 items-center gap-2.5">
      {party.imageUrl ? (
        <PhotoZoom
          photos={[{ id: party.id, url: party.imageUrl }]}
          label={`${party.code} 사진 크게 보기`}
          className="shrink-0"
        >
          <span className={box}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={party.imageUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </span>
        </PhotoZoom>
      ) : (
        <span className={box} />
      )}
      <Link
        href={`/profiles/${party.id}`}
        className="min-w-0 transition-opacity hover:opacity-80"
      >
        <p className="display text-[15px] text-[var(--surface-text)]">
          <ProfileCode code={party.code} />
        </p>
        <p className="truncate text-[12px] text-[var(--surface-text-muted)]">
          {[party.name, `${party.birthYear}년생`].filter(Boolean).join(" · ")}
        </p>
      </Link>
    </span>
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
