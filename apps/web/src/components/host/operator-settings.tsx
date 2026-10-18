"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_GROUPS_PER_ADMIN } from "@bolsaram/schemas";
import { cn } from "@/lib/cn";
import { formatWhen } from "@/lib/dates";
import { apiPost, apiPut } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Empty } from "@/components/ui/empty";
import { FormError } from "@/components/ui/field";
import { Panel } from "@/components/host/surface";

/**
 * 관리자 메뉴의 「모임 설정」 — 모임 만들기 승인·초대 코드 여러 번 쓰기 켜기·끄기와
 * 들어온 요청 처리.
 *
 * 관리자만 이 화면에 들어온다(페이지와 API 가 각각 막는다). 여기서 하는 일은 서비스
 * 전체에 걸리므로 무엇이 바뀌는지를 버튼 옆에 문장으로 적는다.
 */

export type OperatorGroupRequest = {
  requestId: string;
  name: string;
  description: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELED";
  createdAt: string;
  decidedAt: string | null;
  requester: {
    displayName: string | null;
    email: string | null;
    groupCount: number;
  };
};

const STATUS_LABEL: Record<OperatorGroupRequest["status"], string> = {
  PENDING: "대기",
  APPROVED: "승인",
  REJECTED: "거절",
  CANCELED: "요청자가 거둠",
};

export function GroupApprovalPanel({
  enabled,
  pendingCount,
  telegramConnected,
}: {
  enabled: boolean;
  pendingCount: number;
  telegramConnected: boolean;
}) {
  const { on, busy, error, toggle } = useSettingSwitch(enabled, "groupCreationRequiresApproval");

  return (
    <Panel title="모임 만들기 승인">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p id="group-approval-label" className="text-[14px] font-medium">
            {on ? "관리자가 승인해야 모임이 만들어집니다" : "주선자가 바로 모임을 만듭니다"}
          </p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
            {on
              ? "주선자가 「새 모임 만들기」를 누르면 요청만 남고, 아래에서 승인하는 순간 모임이 생겨 그 주선자가 모임장이 됩니다. 관리자 본인은 기다리지 않고 바로 만듭니다."
              : "켜면 그때부터 주선자의 「새 모임 만들기」가 요청으로 바뀝니다. 초대 코드로 참여하는 것은 승인과 무관합니다."}
          </p>
          {!on && pendingCount > 0 ? (
            <p className="mt-1.5 text-[12px] text-[var(--color-rose-600)]">
              꺼도 이미 들어온 요청 {pendingCount}건은 남아 있습니다. 아래에서 처리하세요.
            </p>
          ) : null}
          {on ? (
            telegramConnected ? (
              <p className="mt-1.5 text-[12px] text-[var(--surface-text-muted)]">
                요청이 들어오면 텔레그램으로 알려 드립니다.
              </p>
            ) : (
              <p className="mt-1.5 text-[12px] text-[var(--color-rose-600)]">
                텔레그램이 연결되지 않아 요청 알림을 받지 못합니다.{" "}
                <Link href="/account" className="underline underline-offset-2">
                  내 계정에서 연결
                </Link>
              </p>
            )
          ) : null}
        </div>
        <Switch
          checked={on}
          disabled={busy}
          labelledBy="group-approval-label"
          onChange={() => void toggle()}
        />
      </div>
      <FormError>{error}</FormError>
    </Panel>
  );
}

export function GroupInviteReusePanel({ enabled }: { enabled: boolean }) {
  const { on, busy, error, toggle } = useSettingSwitch(enabled, "groupInviteReusable");

  return (
    <Panel title="모임 초대 코드">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p id="group-invite-reuse-label" className="text-[14px] font-medium">
            {on
              ? "24시간 동안 같은 코드로 여러 명이 참여합니다"
              : "초대 코드는 1회용입니다 — 한 사람만 참여합니다"}
          </p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
            {on
              ? "지금부터 발급하는 코드는 만료(24시간) 전까지 몇 명이든 쓸 수 있습니다. 코드가 밖으로 새면 누구나 그 모임의 멤버 전체를 보게 되니 전달에 주의하라고 안내하세요. 끄면 이미 나간 코드도 바로 1회용으로 돌아가고, 한 번 쓰인 코드는 그때부터 막힙니다."
              : "켜면 그때부터 발급하는 코드는 24시간 동안 여러 명이 함께 쓸 수 있습니다. 이미 나간 1회용 코드는 1회용으로 남습니다."}
          </p>
        </div>
        <Switch
          checked={on}
          disabled={busy}
          labelledBy="group-invite-reuse-label"
          onChange={() => void toggle()}
        />
      </div>
      <FormError>{error}</FormError>
    </Panel>
  );
}

/**
 * 설정 하나를 켜고 끄는 상태. 누르는 즉시 화면을 바꾸고 저장하며, 실패하면 되돌린다.
 */
function useSettingSwitch(
  initial: boolean,
  key: "groupCreationRequiresApproval" | "groupInviteReusable",
) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !on;
    setOn(next);
    setBusy(true);
    setError(null);
    const result = await apiPut("/api/operator/settings", { [key]: next });
    setBusy(false);
    if (!result.ok) {
      setOn(!next);
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return { on, busy, error, toggle };
}

/** 켜고 끄는 스위치. 누르는 즉시 저장한다. */
function Switch({
  checked,
  disabled,
  labelledBy,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  labelledBy: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
        "duration-[var(--duration-quick)]",
        checked ? "bg-[var(--color-rose-600)]" : "bg-[var(--color-ink-300)]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block size-5 rounded-full bg-white shadow transition-transform duration-[var(--duration-quick)]",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
      <span className="sr-only">{checked ? "켜짐" : "꺼짐"}</span>
    </button>
  );
}

export function GroupRequestQueue({ pending }: { pending: OperatorGroupRequest[] }) {
  return (
    <Panel title={`기다리는 요청 ${pending.length}건`}>
      {pending.length === 0 ? (
        <Empty
          title="기다리는 요청이 없습니다"
          description="승인이 켜져 있을 때 주선자가 모임을 만들면 여기에 쌓입니다."
        />
      ) : (
        <ul className="divide-y divide-[var(--surface-border)]">
          {pending.map((request) => (
            <PendingRow key={request.requestId} request={request} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function PendingRow({ request }: { request: OperatorGroupRequest }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = request.requester.groupCount >= MAX_GROUPS_PER_ADMIN;

  async function decide(action: "approve" | "reject") {
    setBusy(true);
    setError(null);
    const result = await apiPost(
      `/api/operator/group-requests/${request.requestId}/${action}`,
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      // 다른 탭에서 이미 처리했을 수 있다 — 목록을 새로 받아 지금 상태를 보여준다.
      router.refresh();
      return;
    }
    router.refresh();
  }

  return (
    <li className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-medium">{request.name}</p>
          <p className="mt-0.5 text-[12px] text-[var(--surface-text-muted)]">
            {requesterLabel(request)} · {formatWhen(request.createdAt)} 요청 · 지금 모임{" "}
            {request.requester.groupCount}개
          </p>
          {request.description ? (
            <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--surface-text)]">
              {request.description}
            </p>
          ) : null}
          {full ? (
            <p className="mt-1.5 text-[12px] text-[var(--color-rose-600)]">
              이 주선자는 이미 모임 {MAX_GROUPS_PER_ADMIN}개에 속해 있어 승인할 수 없습니다.
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ConfirmButton
            variant="ghost"
            label="거절"
            confirmLabel="거절하기"
            message="요청한 주선자에게 「승인되지 않음」으로 보입니다."
            disabled={busy}
            onConfirm={() => void decide("reject")}
          />
          <Button size="sm" disabled={busy || full} onClick={() => void decide("approve")}>
            {busy ? "처리 중…" : "승인"}
          </Button>
        </div>
      </div>
      <FormError>{error}</FormError>
    </li>
  );
}

export function GroupRequestHistory({ recent }: { recent: OperatorGroupRequest[] }) {
  if (recent.length === 0) return null;
  return (
    <Panel title="최근 처리한 요청">
      <ul className="divide-y divide-[var(--surface-border)]">
        {recent.map((request) => (
          <li
            key={request.requestId}
            className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="truncate text-[13.5px]">{request.name}</p>
              <p className="text-[11.5px] text-[var(--surface-text-muted)]">
                {requesterLabel(request)}
                {request.decidedAt ? ` · ${formatWhen(request.decidedAt)}` : ""}
              </p>
            </div>
            <Badge
              tone={
                request.status === "APPROVED"
                  ? "active"
                  : request.status === "REJECTED"
                    ? "danger"
                    : "neutral"
              }
            >
              {STATUS_LABEL[request.status]}
            </Badge>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function requesterLabel(request: OperatorGroupRequest): string {
  const name = request.requester.displayName ?? "주선자";
  return request.requester.email ? `${name} (${request.requester.email})` : name;
}
