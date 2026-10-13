"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { HOST_SUSPEND_REASON_MAX_LENGTH } from "@bolsaram/schemas";
import { formatWhen } from "@/lib/dates";
import { apiDelete, apiPut } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Dialog } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Field, FormError, Input, Textarea } from "@/components/ui/field";
import { Panel } from "@/components/host/surface";

/**
 * 관리자 메뉴의 「주선자」 — 가입한 주선자 목록과 정지·정지 풀기.
 *
 * 정지는 되돌릴 수 있지만 그 사이 일어나는 일(세션 끊김·프로필 비활성)은 되돌아오지
 * 않는다. 그래서 정지는 확인 창에서 무엇이 바뀌는지를 숫자와 함께 보여주고 누르게 한다.
 */

export type OperatorHost = {
  userId: string;
  displayName: string | null;
  email: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  isOperator: boolean;
  groups: string[];
  activeProfiles: number;
  totalProfiles: number;
  telegramConnected: boolean;
  suspension: { at: string; reason: string | null; byName: string | null } | null;
};

export function HostList({ hosts }: { hosts: OperatorHost[] }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? hosts.filter((host) =>
        [host.displayName, host.email].some((v) => v?.toLowerCase().includes(needle)),
      )
    : hosts;
  const suspended = hosts.filter((host) => host.suspension).length;

  return (
    <Panel title={`주선자 ${hosts.length}명${suspended ? ` · 정지 ${suspended}명` : ""}`}>
      {hosts.length > 5 ? (
        <div className="mb-3">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="이름이나 이메일로 찾기"
            aria-label="주선자 찾기"
          />
        </div>
      ) : null}
      {shown.length === 0 ? (
        <Empty
          title={hosts.length === 0 ? "아직 주선자가 없습니다" : "맞는 주선자가 없습니다"}
          description={
            hosts.length === 0
              ? "카카오·구글로 처음 로그인하면 주선자 계정이 생깁니다."
              : "검색어를 바꿔 보세요."
          }
        />
      ) : (
        <ul className="divide-y divide-[var(--surface-border)]">
          {shown.map((host) => (
            <HostItem key={host.userId} host={host} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function HostItem({ host }: { host: OperatorHost }) {
  const router = useRouter();
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = host.displayName ?? "이름 없음";

  async function unsuspend() {
    setBusy(true);
    setError(null);
    const result = await apiDelete(`/api/operator/hosts/${host.userId}/suspension`);
    setBusy(false);
    if (!result.ok) setError(result.message);
    router.refresh();
  }

  return (
    <li className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[14.5px] font-medium">{name}</span>
            {host.isOperator ? <Badge tone="info">관리자</Badge> : null}
            {host.suspension ? <Badge tone="danger">정지됨</Badge> : null}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-[var(--surface-text-muted)]">
            {host.email ?? "이메일 없음"} · {formatWhen(host.createdAt)} 가입 · 마지막 로그인{" "}
            {host.lastLoginAt ? formatWhen(host.lastLoginAt) : "없음"}
          </p>
          <p className="mt-1 text-[12.5px] text-[var(--surface-text)]">
            {host.isOperator
              ? "모든 모임을 다룹니다"
              : host.groups.length > 0
                ? `모임 ${host.groups.join(", ")}`
                : "모임 없음 — 전체공개만"}
            {" · "}프로필 공개 {host.activeProfiles} / 전체 {host.totalProfiles}
            {" · "}텔레그램 {host.telegramConnected ? "연결" : "미연결"}
          </p>
          {host.suspension ? (
            <p className="mt-1.5 rounded-[10px] bg-[var(--color-rose-100)] px-3 py-2 text-[12px] leading-relaxed text-[var(--color-burgundy-800)]">
              {formatWhen(host.suspension.at)} 정지
              {host.suspension.byName ? ` · ${host.suspension.byName}` : ""}
              {host.suspension.reason ? (
                <>
                  <br />
                  {host.suspension.reason}
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        {host.isOperator ? null : (
          <div className="shrink-0">
            {host.suspension ? (
              <ConfirmButton
                label="정지 풀기"
                confirmLabel="정지 풀기"
                message="다시 로그인할 수 있습니다. 비활성으로 돌린 프로필은 그대로이니 주선자가 직접 다시 공개합니다."
                disabled={busy}
                onConfirm={() => void unsuspend()}
              />
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setDialog(true)}>
                정지
              </Button>
            )}
          </div>
        )}
      </div>
      <FormError>{error}</FormError>
      <SuspendDialog host={host} open={dialog} onClose={() => setDialog(false)} />
    </li>
  );
}

function SuspendDialog({
  host,
  open,
  onClose,
}: {
  host: OperatorHost;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = host.displayName ?? "이름 없음";

  function close() {
    setReason("");
    setError(null);
    onClose();
  }

  async function suspend() {
    setBusy(true);
    setError(null);
    const result = await apiPut(`/api/operator/hosts/${host.userId}/suspension`, {
      reason: reason.trim() || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    close();
    router.refresh();
  }

  return (
    <Dialog open={open} onClose={close} label={`${name} 정지`}>
      <h2 className="display text-[19px] text-[var(--surface-text)]">{name} 님 정지</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
        <li>지금 열려 있는 로그인이 모두 끊기고, 다시 로그인할 수 없습니다.</li>
        <li>
          {host.activeProfiles > 0 ? (
            <>
              등록한 프로필 중 공개 중인 <b>{host.activeProfiles}개</b>가 비활성이 됩니다. 정지를
              풀어도 자동으로 다시 공개되지 않습니다.
            </>
          ) : (
            "공개 중인 프로필은 없습니다. 이후 등록하는 일도 막힙니다."
          )}
        </li>
        <li>텔레그램 봇과 알림이 멈추고, 기다리던 모임 만들기 요청은 거절됩니다.</li>
        <li>모임 소속은 남습니다. 정지를 풀면 그대로 돌아옵니다.</li>
      </ul>
      <div className="mt-4">
        <Field label="사유 (선택)" hint="관리자만 봅니다">
          <Textarea
            rows={2}
            maxLength={HOST_SUSPEND_REASON_MAX_LENGTH}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
      <FormError>{error}</FormError>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={close} disabled={busy}>
          취소
        </Button>
        <Button variant="danger" onClick={() => void suspend()} disabled={busy}>
          {busy ? "정지하는 중…" : "정지하기"}
        </Button>
      </div>
    </Dialog>
  );
}
