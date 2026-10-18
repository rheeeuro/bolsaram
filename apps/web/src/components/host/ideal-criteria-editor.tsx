"use client";

import { useState, type ReactNode } from "react";
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
  emptyIdealCriteria,
  formatHashtag,
  idealCriterionStated,
  parseHashtagInput,
  type IdealCriteria,
  type IdealCriterionKey,
} from "@bolsaram/schemas";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";

/** 여러 개를 고르는 항목. 키는 조건 이름, 칸은 `IdealCriteria` 의 배열 칸이다. */
type ListField = "regions" | "religions" | "smoking" | "drinking" | "jobCategories";

const LISTS: {
  key: IdealCriterionKey;
  field: ListField;
  label: string;
  values: readonly string[];
  labels: Record<string, string>;
}[] = [
  { key: "region", field: "regions", label: "지역", values: REGIONS, labels: REGION_LABELS },
  { key: "religion", field: "religions", label: "종교", values: RELIGIONS, labels: RELIGION_LABELS },
  { key: "smoking", field: "smoking", label: "흡연", values: SMOKING_LEVELS, labels: SMOKING_LABELS },
  { key: "drinking", field: "drinking", label: "음주", values: DRINKING_LEVELS, labels: DRINKING_LABELS },
  { key: "job", field: "jobCategories", label: "직업군", values: JOB_CATEGORIES, labels: JOB_CATEGORY_LABELS },
];

function toNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

/**
 * 이상형 조건 편집기. 가져오기 검토와 내용 고치기가 함께 쓴다.
 *
 * 값은 AI 가 이상형 글에서 뽑아 두지만 **주선자가 고치는 프로필 항목**이다 — 추천은 이
 * 값만 견준다. 적힌 확실한 조건을 모두 만족해야 추천이고, 비운 조건은 따지지 않는다.
 * 「꼭」은 거꾸로 상대 멤버의 화면에서 이 분을 빼는 데 쓰인다. 피하는 것은 공통점 추천에서만 쓴다.
 * 정리(뒤집힌 범위·범위 밖 숫자)는 저장할 때 서버가 한다. 여기서 하면 입력 도중에 값이 튄다.
 */
export function IdealCriteriaEditor({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: IdealCriteria | null;
  onChange: (next: IdealCriteria) => void;
  disabled?: boolean;
  /** 가져오기 검토처럼 정보량이 많은 화면에서 글자와 간격을 줄인다. */
  compact?: boolean;
}) {
  const criteria = value ?? emptyIdealCriteria();
  // 키워드는 치는 동안 `#` 이나 띄어쓰기가 남아 있어야 해서 글자 그대로 따로 든다.
  const [keywordText, setKeywordText] = useState(() =>
    criteria.keywords.map(formatHashtag).join(" "),
  );
  const [avoidText, setAvoidText] = useState(() =>
    criteria.avoidKeywords.map(formatHashtag).join(" "),
  );

  const update = (patch: Partial<IdealCriteria>) => {
    const next = { ...criteria, ...patch };
    // 조건을 비우면 「꼭」도 함께 내린다 — 없는 조건을 양보하지 않을 수는 없다.
    next.required = next.required.filter((key) => idealCriterionStated(next, key));
    onChange(next);
  };

  const toggleRequired = (key: IdealCriterionKey) =>
    update({
      required: criteria.required.includes(key)
        ? criteria.required.filter((k) => k !== key)
        : [...criteria.required, key],
    });

  const toggleValue = (field: ListField, item: string) => {
    const list = criteria[field] as string[];
    update({
      [field]: list.includes(item) ? list.filter((v) => v !== item) : [...list, item],
    } as Partial<IdealCriteria>);
  };

  const text = compact ? "text-[12px]" : "text-[13px]";
  const control = compact ? "h-8 text-[12.5px]" : "h-10 text-[13.5px]";

  const Row = ({ label, k, children }: { label: string; k?: IdealCriterionKey; children: ReactNode }) => (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <div className="flex w-full items-center justify-between sm:w-20 sm:shrink-0 sm:flex-col sm:items-start sm:gap-1 sm:pt-1.5">
        <span className={cn(text, "font-medium text-[var(--surface-text)]")}>{label}</span>
        {k ? (
          <button
            type="button"
            disabled={disabled || !idealCriterionStated(criteria, k)}
            aria-pressed={criteria.required.includes(k)}
            title="켜면 이 조건에 맞지 않는 분의 화면에는 이 분이 AI 추천으로 뜨지 않습니다"
            onClick={() => toggleRequired(k)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] transition-colors duration-[var(--duration-quick)]",
              "disabled:cursor-not-allowed disabled:opacity-40",
              criteria.required.includes(k)
                ? "border-[var(--color-rose-600)] bg-[var(--color-rose-600)] text-white"
                : "border-[var(--surface-border)] bg-white text-[var(--surface-text-muted)]",
            )}
          >
            꼭
          </button>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );

  const range = (
    min: number | null,
    max: number | null,
    set: (min: number | null, max: number | null) => void,
    unit: string,
    placeholder: [string, string],
  ) => (
    <div className="flex items-center gap-2">
      <Input
        value={min ?? ""}
        inputMode="numeric"
        disabled={disabled}
        placeholder={placeholder[0]}
        onChange={(e) => set(toNumber(e.target.value), max)}
        className={cn(control, "w-24")}
      />
      <span className={cn(text, "text-[var(--surface-text-muted)]")}>~</span>
      <Input
        value={max ?? ""}
        inputMode="numeric"
        disabled={disabled}
        placeholder={placeholder[1]}
        onChange={(e) => set(min, toNumber(e.target.value))}
        className={cn(control, "w-24")}
      />
      <span className={cn(text, "text-[var(--surface-text-muted)]")}>{unit}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {Row({
        label: "나이",
        k: "age",
        children: range(
          criteria.birthYearMin,
          criteria.birthYearMax,
          (birthYearMin, birthYearMax) => update({ birthYearMin, birthYearMax }),
          "년생",
          ["1990", "1996"],
        ),
      })}
      {Row({
        label: "키",
        k: "height",
        children: range(
          criteria.heightMin,
          criteria.heightMax,
          (heightMin, heightMax) => update({ heightMin, heightMax }),
          "cm",
          ["175", ""],
        ),
      })}
      {LISTS.map((list) =>
        Row({
          label: list.label,
          k: list.key,
          children: (
            <div className="flex flex-wrap gap-1.5">
              {list.values.map((item) => {
                const on = (criteria[list.field] as string[]).includes(item);
                return (
                  <button
                    key={item}
                    type="button"
                    disabled={disabled}
                    aria-pressed={on}
                    onClick={() => toggleValue(list.field, item)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 transition-colors duration-[var(--duration-quick)]",
                      compact ? "text-[11.5px]" : "text-[12.5px]",
                      "disabled:cursor-not-allowed disabled:opacity-60",
                      on
                        ? "border-[var(--color-rose-600)] bg-[var(--color-rose-100)] text-[var(--color-rose-600)]"
                        : "border-[var(--surface-border)] bg-white text-[var(--surface-text-muted)] hover:border-[var(--color-rose-300)]",
                    )}
                  >
                    {list.labels[item] ?? item}
                  </button>
                );
              })}
            </div>
          ),
        }),
      )}
      {Row({
        label: "키워드",
        children: (
          <Input
            value={keywordText}
            disabled={disabled}
            placeholder="#운동 #여행 #다정함"
            onChange={(e) => {
              setKeywordText(e.target.value);
              update({ keywords: parseHashtagInput(e.target.value) });
            }}
            className={control}
          />
        ),
      })}
      {Row({
        label: "피하는 것",
        children: (
          <Input
            value={avoidText}
            disabled={disabled}
            placeholder="#문신"
            onChange={(e) => {
              setAvoidText(e.target.value);
              update({ avoidKeywords: parseHashtagInput(e.target.value) });
            }}
            className={control}
          />
        ),
      })}
      <p className={cn("text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]")}>
        적어 둔 조건을 상대가 모두 만족해야 AI 추천이 붙고, 비워 둔 조건은 따지지 않습니다.
        「꼭」을 켜면 이 조건에 맞지 않는 분의 화면에는 이 분이 추천으로 뜨지 않습니다.
        키워드는 판정에 쓰지 않고, 피하는 것은 공통점으로 추천할 때 그 낱말을 가진 분을 뺍니다.
      </p>
    </div>
  );
}
