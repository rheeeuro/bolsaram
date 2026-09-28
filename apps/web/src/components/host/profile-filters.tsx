"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { PROFILE_STATUS_LABELS, type ProfileStatus } from "@bolsaram/schemas";
import { Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { FilterSheet } from "@/components/member/filter-sheet";
import {
  activeFilterCount,
  clearFilter,
  filterSummary,
  filtersFromParams,
  filtersToParams,
  type Filters,
} from "@/components/member/filter-model";
import { rememberProfilesList } from "@/components/host/profiles-list-link";
import { cn } from "@/lib/cn";

/** 조건 시트가 다루는 주소 키. 시트를 적용하면 이 키들을 통째로 갈아 끼운다. */
const SHEET_KEYS = [
  "ageMin",
  "ageMax",
  "heightMin",
  "heightMax",
  "regions",
  "jobCategories",
  "religions",
  "smoking",
  "drinking",
  "tags",
] as const;

/** 시트 밖에서 고르는 조건. 시트의 「N명 보기」에도 함께 걸려야 숫자가 맞는다. */
const BAR_KEYS = ["q", "status", "gender", "claimed"] as const;

/**
 * 프로필 목록 필터.
 *
 * 카카오톡방에서 가장 오래 걸리던 일 — 「여자, 93~96년생, 165 이상」을 스크롤로
 * 찾는 것 — 을 여기서 끝낸다. 자주 바꾸는 성별·상태는 바에서 한 번에 누르고,
 * 나이·키·지역·직업군은 멤버 화면과 같은 조건 시트에서 고른다. 걸린 조건은 목록 위에
 * 칩으로 남아 하나씩 지운다.
 *
 * 모든 조건은 주소에 담는다 — 새로고침·뒤로 가기·링크 공유에서 그대로 살아 있다.
 */
export function HostProfileFilters({ statuses }: { statuses: readonly ProfileStatus[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [sheetOpen, setSheetOpen] = useState(false);

  const paramString = params.toString();
  const filters = useMemo(() => filtersFromParams(new URLSearchParams(paramString)), [paramString]);
  const summary = filterSummary(filters, new Date().getFullYear());

  // 상세에서 「프로필」로 돌아올 때 이 조건으로 돌아오게 기억해 둔다.
  useEffect(() => rememberProfilesList(paramString), [paramString]);

  function push(search: URLSearchParams) {
    // 조건이 달라지면 현재 커서는 더 이상 같은 목록을 가리키지 않는다.
    search.delete("cursor");
    const qs = search.toString();
    router.push(qs ? `/profiles?${qs}` : "/profiles");
  }

  function apply(next: Record<string, string>) {
    const search = new URLSearchParams(paramString);
    for (const [key, value] of Object.entries(next)) {
      if (value.length === 0) search.delete(key);
      else search.set(key, value);
    }
    push(search);
  }

  function applySheet(next: Filters) {
    const search = new URLSearchParams(paramString);
    for (const key of SHEET_KEYS) search.delete(key);
    for (const [key, value] of filtersToParams(next)) search.set(key, value);
    push(search);
  }

  // 시트가 미리 세는 숫자에 바의 조건도 싣는다. 바 조건이 바뀔 때만 새 함수가 된다.
  const barQuery = useMemo(() => {
    const current = new URLSearchParams(paramString);
    const kept = new URLSearchParams();
    for (const key of BAR_KEYS) {
      const value = current.get(key);
      if (value) kept.set(key, value);
    }
    return kept.toString();
  }, [paramString]);
  const countUrl = useCallback(
    (query: string) =>
      `/api/admin/profiles?${[query, barQuery].filter((part) => part.length > 0).join("&")}`,
    [barQuery],
  );

  const status = params.get("status") ?? "";
  const gender = params.get("gender") ?? "";
  const sheetCount = activeFilterCount(filters);
  const anyCondition =
    sheetCount > 0 || BAR_KEYS.some((key) => (params.get(key) ?? "").length > 0);

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ q: q.trim() });
        }}
      >
        <Input
          type="search"
          placeholder="이름 · 직업 · 학교 · 동네 · 원문의 아무 말 · 17번"
          aria-label="프로필 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-10 min-w-0 flex-1 sm:max-w-md"
        />
        <Button type="submit" variant="secondary">
          찾기
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="성별"
          value={gender}
          options={[
            { value: "", label: "남녀" },
            { value: "MALE", label: "남성" },
            { value: "FEMALE", label: "여성" },
          ]}
          onChange={(value) => apply({ gender: value })}
        />
        <Segmented
          label="상태"
          value={status}
          options={[
            { value: "", label: "전체" },
            ...statuses.map((value) => ({ value, label: PROFILE_STATUS_LABELS[value] })),
          ]}
          onChange={(value) => apply({ status: value })}
        />
        <Select
          aria-label="초대"
          className="h-9 w-auto text-[13px]"
          value={params.get("claimed") ?? ""}
          onChange={(e) => apply({ claimed: e.target.value })}
        >
          <option value="">초대 전체</option>
          <option value="yes">계정 연결됨</option>
          <option value="no">초대 전</option>
        </Select>

        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          className={cn(
            "flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors",
            "duration-[var(--duration-quick)]",
            sheetCount > 0
              ? "border-[var(--color-rose-500)] bg-[var(--surface-card)] text-[var(--color-rose-600)]"
              : "border-[var(--surface-border)] bg-[var(--surface-card)] text-[var(--surface-text)] hover:border-[var(--color-rose-300)]",
          )}
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path
              d="M3 5h14M6 10h8M9 15h2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          나이 · 키 · 지역
          {sheetCount > 0 ? (
            <span className="grid h-4 min-w-4 place-items-center rounded-full bg-[var(--color-rose-500)] px-1 text-[10px] text-white">
              {sheetCount}
            </span>
          ) : null}
        </button>
      </div>

      {anyCondition ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {summary.map((item) => (
            <RemovableChip
              key={item.key}
              onRemove={() => applySheet(clearFilter(filters, item.key))}
            >
              {item.label}
            </RemovableChip>
          ))}
          <button
            type="button"
            onClick={() => {
              setQ("");
              // 보기 모드는 조건이 아니라 화면의 것이라 남긴다.
              const view = params.get("view");
              router.push(view ? `/profiles?view=${view}` : "/profiles");
            }}
            className="px-1.5 py-1 text-[12.5px] text-[var(--surface-text-muted)] underline-offset-2 hover:text-[var(--color-rose-600)] hover:underline"
          >
            조건 모두 지우기
          </button>
        </div>
      ) : null}

      <FilterSheet
        open={sheetOpen}
        initial={filters}
        onClose={() => setSheetOpen(false)}
        onApply={(next) => {
          setSheetOpen(false);
          applySheet(next);
        }}
        countUrl={countUrl}
      />
    </div>
  );
}

/** 한 줄짜리 선택. 값이 둘셋뿐이라 선택 상자보다 한 번에 눌러 바꾸는 편이 빠르다. */
function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex h-9 items-center gap-0.5 rounded-full border border-[var(--surface-border)] bg-[var(--surface-card)] p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value || "all"}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-full rounded-full px-3 text-[13px] transition-colors duration-[var(--duration-quick)]",
              active
                ? "bg-[var(--color-rose-600)] text-white"
                : "text-[var(--surface-text-muted)] hover:text-[var(--surface-text)]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function RemovableChip({ children, onRemove }: { children: ReactNode; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[12.5px]",
        "border-[var(--color-rose-300)] bg-[var(--color-rose-100)] text-[var(--color-rose-600)]",
        "transition-colors duration-[var(--duration-quick)] hover:border-[var(--color-rose-500)]",
      )}
    >
      <span>{children}</span>
      <span aria-hidden className="text-[13px] leading-none opacity-70">
        ×
      </span>
      <span className="sr-only">조건 지우기</span>
    </button>
  );
}
