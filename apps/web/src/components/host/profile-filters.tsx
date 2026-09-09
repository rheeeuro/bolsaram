"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { PROFILE_STATUS_LABELS } from "@bolsaram/schemas";
import { Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * 프로필 목록 필터.
 * 상태는 알약으로 한 번에 고르고, 나머지는 URL 에 담아 새로고침/공유가 가능하게 한다.
 */
export function HostProfileFilters({ statuses }: { statuses: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  function apply(next: Record<string, string>) {
    const search = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value.length === 0) search.delete(key);
      else search.set(key, value);
    }
    router.push(`/profiles?${search.toString()}`);
  }

  const status = params.get("status") ?? "";

  return (
    <div className="flex flex-col gap-3">
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
        <StatusPill label="전체" active={status === ""} onClick={() => apply({ status: "" })} />
        {statuses.map((value) => (
          <StatusPill
            key={value}
            label={PROFILE_STATUS_LABELS[value as keyof typeof PROFILE_STATUS_LABELS] ?? value}
            active={status === value}
            onClick={() => apply({ status: value })}
          />
        ))}
      </div>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ q });
        }}
      >
        <Input
          placeholder="이름 · 회사 · 직업 · #번호로 찾기"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-10 w-full sm:w-72"
        />
        <Select
          className="h-10 w-36"
          value={params.get("claimed") ?? ""}
          onChange={(e) => apply({ claimed: e.target.value })}
        >
          <option value="">초대 전체</option>
          <option value="yes">계정 연결됨</option>
          <option value="no">초대 전</option>
        </Select>
        <Button type="submit" variant="secondary">
          찾기
        </Button>
      </form>
    </div>
  );
}

function StatusPill({
  label,
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
          ? "border-[var(--color-rose-500)] bg-[var(--color-rose-500)] text-white"
          : "border-[var(--surface-border)] bg-[var(--surface-card)] text-[var(--surface-text-muted)] hover:border-[var(--color-rose-300)]",
      )}
    >
      {label}
    </button>
  );
}
