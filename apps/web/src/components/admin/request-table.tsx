"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { MATCH_REQUEST_STATUSES, MATCH_REQUEST_STATUS_LABELS } from "@bolsaram/schemas";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Td, Th } from "@/components/admin/table";
import { apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { label } from "@/lib/labels";

type Party = { id: string; code: string; name: string | null } | null;

export type AdminRequestItem = {
  id: string;
  status: string;
  message: string | null;
  requestedAt: string;
  requester: Party;
  target: Party;
};

export function AdminRequestTable({
  items,
  activeStatus,
}: {
  items: AdminRequestItem[];
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
    router.push(`/admin/requests?${search.toString()}`);
  }

  async function close(id: string) {
    setBusy(true);
    setError(null);
    const result = await apiPost(`/api/admin/match-requests/${id}/close`);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-1.5">
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
        <p className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)] py-12 text-center text-[13px] text-[var(--surface-text-muted)]">
          해당 상태의 신청이 없습니다.
        </p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>신청자</Th>
              <Th>대상</Th>
              <Th>상태</Th>
              <Th>메시지</Th>
              <Th>신청 시각</Th>
              <Th>처리</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="align-top hover:bg-[var(--surface-muted)]">
                <Td>
                  <PartyCell party={item.requester} />
                </Td>
                <Td>
                  <PartyCell party={item.target} />
                </Td>
                <Td>
                  <Badge tone={toneForStatus(item.status)}>
                    {label.matchStatus(item.status)}
                  </Badge>
                </Td>
                <Td className="max-w-56 text-[12.5px] text-[var(--surface-text-muted)]">
                  {item.message ?? "—"}
                </Td>
                <Td className="whitespace-nowrap text-[12.5px] text-[var(--surface-text-muted)]">
                  {new Date(item.requestedAt).toLocaleString("ko-KR", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Td>
                <Td>
                  {item.status === "INTRODUCED" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void close(item.id)}
                    >
                      종료
                    </Button>
                  ) : (
                    <span className="text-[12.5px] text-[var(--surface-text-muted)]">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

function PartyCell({ party }: { party: Party }) {
  if (!party) return <span className="text-[var(--surface-text-muted)]">삭제됨</span>;
  return (
    <Link href={`/admin/profiles/${party.id}`} className="hover:underline">
      <span className="font-medium">{party.code}</span>
      {party.name ? (
        <span className="ml-1.5 text-[12px] text-[var(--surface-text-muted)]">
          {party.name}
        </span>
      ) : null}
    </Link>
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
      onClick={onClick}
      className={cn(
        "rounded-md border px-2.5 py-1 text-[12.5px] transition-colors",
        active
          ? "border-[var(--surface-accent)] bg-[var(--surface-accent)]/8 text-[var(--surface-accent)]"
          : "border-[var(--surface-border)] text-[var(--surface-text-muted)] hover:text-[var(--surface-text)]",
      )}
    >
      {text}
    </button>
  );
}
