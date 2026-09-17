"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DRINKING_LABELS,
  DRINKING_LEVELS,
  JOB_CATEGORIES,
  JOB_CATEGORY_LABELS,
  REGIONS,
  REGION_LABELS,
  RELIGIONS,
  RELIGION_LABELS,
  SMOKING_LABELS,
  SMOKING_LEVELS,
  formatHashtag,
  normalizeHashtags,
  parseHashtagInput,
} from "@bolsaram/schemas";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Dialog, DialogClose } from "@/components/ui/dialog";
import { apiGet } from "@/lib/api-client";
import {
  AGE_RANGE,
  DEFAULT_FILTERS,
  HEIGHT_RANGE,
  filtersToParams,
  rangeLabel,
  type Filters,
} from "./filter-model";

/**
 * 조건 설정 bottom sheet (UI 컨셉 03).
 * 값이 바뀔 때마다 결과 개수를 미리 조회해 "N명 보기" 로 보여준다.
 * 조건 판정은 전부 filter-model 에 있다 — 여기서는 그리는 일만 한다.
 */
export function FilterSheet({
  open,
  initial,
  gender,
  onClose,
  onApply,
}: {
  open: boolean;
  initial: Filters;
  gender: string | null;
  onClose: () => void;
  onApply: (filters: Filters) => void;
}) {
  const [draft, setDraft] = useState<Filters>(initial);
  const [count, setCount] = useState<number | null>(null);

  // 시트를 열 때마다 현재 적용값에서 시작한다.
  useEffect(() => {
    if (open) setDraft(initial);
  }, [open, initial]);

  const query = useMemo(() => filtersToParams(draft, gender).toString(), [draft, gender]);

  // 결과 개수 미리보기. 입력이 멈춘 뒤에만 요청한다.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void apiGet<{ total: number }>(`/api/profiles?${query}&limit=1`).then((result) => {
        if (cancelled) return;
        setCount(result.ok ? result.data.total : null);
      });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const toggle = (key: keyof Filters, value: string) => {
    setDraft((prev) => {
      const list = prev[key] as string[];
      return {
        ...prev,
        [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
      };
    });
  };

  return (
    <Dialog open={open} onClose={onClose} label="조건 설정" variant="sheet">
      <header className="flex items-center justify-between border-b border-[var(--surface-border)] px-5 py-4">
        <h2 className="text-[16px] font-medium">조건 설정</h2>
        <DialogClose onClose={onClose} />
      </header>

      <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-5">
        <RangeGroup
          title="나이"
          unit="세"
          min={AGE_RANGE.min}
          max={AGE_RANGE.max}
          valueMin={draft.ageMin}
          valueMax={draft.ageMax}
          onChange={(lo, hi) => setDraft((p) => ({ ...p, ageMin: lo, ageMax: hi }))}
        />
        <RangeGroup
          title="키"
          unit="cm"
          min={HEIGHT_RANGE.min}
          max={HEIGHT_RANGE.max}
          valueMin={draft.heightMin}
          valueMax={draft.heightMax}
          onChange={(lo, hi) => setDraft((p) => ({ ...p, heightMin: lo, heightMax: hi }))}
          note="키가 적혀 있지 않은 분은 키 조건을 걸면 나오지 않습니다."
        />

        <ChipGroup
          title="지역"
          values={REGIONS}
          labels={REGION_LABELS}
          selected={draft.regions}
          onToggle={(v) => toggle("regions", v)}
          onClear={() => setDraft((p) => ({ ...p, regions: [] }))}
        />
        <ChipGroup
          title="직업군"
          values={JOB_CATEGORIES}
          labels={JOB_CATEGORY_LABELS}
          selected={draft.jobCategories}
          onToggle={(v) => toggle("jobCategories", v)}
          onClear={() => setDraft((p) => ({ ...p, jobCategories: [] }))}
        />
        <ChipGroup
          title="종교"
          values={RELIGIONS}
          labels={RELIGION_LABELS}
          selected={draft.religions}
          onToggle={(v) => toggle("religions", v)}
          onClear={() => setDraft((p) => ({ ...p, religions: [] }))}
        />
        <ChipGroup
          title="흡연"
          values={SMOKING_LEVELS}
          labels={SMOKING_LABELS}
          selected={draft.smoking}
          onToggle={(v) => toggle("smoking", v)}
          onClear={() => setDraft((p) => ({ ...p, smoking: [] }))}
        />
        <ChipGroup
          title="음주"
          values={DRINKING_LEVELS}
          labels={DRINKING_LABELS}
          selected={draft.drinking}
          onToggle={(v) => toggle("drinking", v)}
          onClear={() => setDraft((p) => ({ ...p, drinking: [] }))}
        />

        <TagGroup
          selected={draft.tags}
          onAdd={(tags) =>
            setDraft((p) => ({ ...p, tags: normalizeHashtags([...p.tags, ...tags]) }))
          }
          onRemove={(tag) => setDraft((p) => ({ ...p, tags: p.tags.filter((t) => t !== tag) }))}
        />
      </div>

      <footer
        className="flex gap-2 border-t border-[var(--surface-border)] px-5 py-4"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        <Button
          variant="secondary"
          size="lg"
          className="flex-1"
          onClick={() => setDraft(DEFAULT_FILTERS)}
        >
          초기화
        </Button>
        <Button size="lg" className="flex-[2]" onClick={() => onApply(draft)}>
          {count == null ? "결과 보기" : `${count}명 보기`}
        </Button>
      </footer>
    </Dialog>
  );
}

/**
 * 해시태그 입력. 값을 미리 줄 수 없으므로(프로필에서 올라온 자유 태그) 칩 목록이
 * 아니라 입력으로 받는다. 넣은 태그는 지울 수 있는 칩으로 남는다.
 */
function TagGroup({
  selected,
  onAdd,
  onRemove,
}: {
  selected: string[];
  onAdd: (tags: string[]) => void;
  onRemove: (tag: string) => void;
}) {
  const [text, setText] = useState("");

  function commit() {
    const tags = parseHashtagInput(text);
    if (tags.length > 0) onAdd(tags);
    setText("");
  }

  return (
    <section className="mb-6">
      <h3 className="mb-2.5 text-[13px] font-medium text-[var(--color-ink-800)]">해시태그</h3>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // 스페이스로도 확정한다 — 태그를 이어 적는 흐름이 끊기지 않게.
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          commit();
        }}
        placeholder="#등산"
        aria-label="해시태그 추가"
        className="h-10 w-full rounded-[10px] border border-[var(--surface-border)] bg-white px-3 text-[14px] outline-none focus:border-[var(--color-rose-400)]"
      />
      {selected.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {selected.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onRemove(tag)}
              aria-label={`${formatHashtag(tag)} 빼기`}
              className="rounded-full border border-[var(--color-rose-400)] bg-[var(--color-rose-100)] px-3 py-1 text-[13px] text-[var(--color-rose-600)]"
            >
              {formatHashtag(tag)} ×
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-[var(--color-ink-500)]">
          프로필에 붙은 태그로 찾습니다. 여러 개를 넣으면 모두 가진 분만 보입니다.
        </p>
      )}
    </section>
  );
}

function ChipGroup({
  title,
  values,
  labels,
  selected,
  onToggle,
  onClear,
}: {
  title: string;
  values: readonly string[];
  labels: Record<string, string>;
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <section className="mb-6">
      <h3 className="mb-2.5 text-[13px] font-medium text-[var(--color-ink-800)]">{title}</h3>
      <div className="flex flex-wrap gap-1.5">
        <Chip label="전체" selected={selected.length === 0} onClick={onClear} />
        {values.map((value) => (
          <Chip
            key={value}
            label={labels[value] ?? value}
            selected={selected.includes(value)}
            onClick={() => onToggle(value)}
          />
        ))}
      </div>
    </section>
  );
}

/** 두 개의 range 를 겹치지 않게 묶는다. 값이 교차하면 서로를 밀어낸다. */
function RangeGroup({
  title,
  unit,
  min,
  max,
  valueMin,
  valueMax,
  onChange,
  note,
}: {
  title: string;
  unit: string;
  min: number;
  max: number;
  valueMin: number;
  valueMax: number;
  onChange: (lo: number, hi: number) => void;
  note?: string;
}) {
  const narrowed = valueMin > min || valueMax < max;
  const pct = (value: number) => ((value - min) / (max - min)) * 100;
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[13px] font-medium text-[var(--color-ink-800)]">{title}</h3>
        <span className="text-[13px] text-[var(--color-ink-600)]">
          {rangeLabel({ min, max, valueMin, valueMax, unit })}
        </span>
      </div>
      {/* 두 손잡이를 같은 트랙 위에 겹친다. 값이 교차하면 서로를 밀어낸다. */}
      <div className="range-dual">
        <span className="range-dual__track" />
        <span
          className="range-dual__fill"
          style={{ left: `${pct(valueMin)}%`, right: `${100 - pct(valueMax)}%` }}
        />
        <input
          type="range"
          aria-label={`${title} 최소`}
          min={min}
          max={max}
          value={valueMin}
          onChange={(e) => onChange(Math.min(Number(e.target.value), valueMax), valueMax)}
        />
        <input
          type="range"
          aria-label={`${title} 최대`}
          min={min}
          max={max}
          value={valueMax}
          onChange={(e) => onChange(valueMin, Math.max(Number(e.target.value), valueMin))}
        />
      </div>
      {note && narrowed ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--color-ink-500)]">{note}</p>
      ) : null}
    </section>
  );
}
