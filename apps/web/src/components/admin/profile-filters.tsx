"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { PROFILE_STATUS_LABELS } from "@bolsaram/schemas";
import { Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

/** 프로필 목록 필터 바. 상태는 URL 에 담아 새로고침/공유가 가능하게 한다. */
export function AdminProfileFilters({ statuses }: { statuses: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  function apply(next: Record<string, string>) {
    const search = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value.length === 0) search.delete(key);
      else search.set(key, value);
    }
    router.push(`/admin/profiles?${search.toString()}`);
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        apply({ q });
      }}
    >
      <Input
        placeholder="이름 · 회사 · 직업 · #코드"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="h-9 w-64"
      />
      <Select
        className="h-9 w-36"
        value={params.get("status") ?? ""}
        onChange={(e) => apply({ status: e.target.value })}
      >
        <option value="">전체 상태</option>
        {statuses.map((status) => (
          <option key={status} value={status}>
            {PROFILE_STATUS_LABELS[status as keyof typeof PROFILE_STATUS_LABELS] ?? status}
          </option>
        ))}
      </Select>
      <Select
        className="h-9 w-32"
        value={params.get("claimed") ?? ""}
        onChange={(e) => apply({ claimed: e.target.value })}
      >
        <option value="">계정 전체</option>
        <option value="yes">연결됨</option>
        <option value="no">미연결</option>
      </Select>
      <Select
        className="h-9 w-40"
        value={params.get("consent") ?? ""}
        onChange={(e) => apply({ consent: e.target.value })}
      >
        <option value="">동의 전체</option>
        <option value="pending">동의 확인 필요</option>
      </Select>
      <Button type="submit" variant="secondary" size="sm">
        검색
      </Button>
    </form>
  );
}
