"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  DRINKING_LABELS,
  DRINKING_LEVELS,
  GENDERS,
  GENDER_LABELS,
  JOB_CATEGORIES,
  JOB_CATEGORY_LABELS,
  LOW_CONFIDENCE_THRESHOLD,
  MBTI_TYPES,
  REGIONS,
  REGION_LABELS,
  RELIGIONS,
  RELIGION_LABELS,
  SMOKING_LABELS,
  SMOKING_LEVELS,
} from "@bolsaram/schemas";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/host/surface";
import { GroupPicker, type GroupChoice } from "@/components/host/group-picker";
import { Input, Select, Textarea } from "@/components/ui/field";
import { apiPatch, apiPost, uploadFile } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { FIELD_LABELS, label } from "@/lib/labels";

type FieldReview = {
  key: string;
  confidence: number;
  needsAttention: boolean;
  required: boolean;
};

type Extraction = {
  fields: Record<string, unknown>;
  confidence: Record<string, number | undefined>;
  notes: string[];
  model: string;
  promptVersion: string;
  review: FieldReview[];
};

type Session = {
  id: string;
  status: string;
  source: string;
  rawText: string | null;
  errorMessage: string | null;
  committedProfileId: string | null;
  /** 등록될 모임. null 이면 전체공개다. */
  groupId: string | null;
  /** 전체공개로 되돌릴 수 있는가 — 세션을 만든 사람만 할 수 있다. */
  canUsePublic: boolean;
  /**
   * 텔레그램으로 들어온 경우의 대화 정보 (설계 변경 문서 TELEGRAM v1 §13).
   * 텔레그램 사용자명·식별값은 담지 않는다 — 검토에 필요하지 않다.
   */
  telegram: { state: string; startedAt: string; lastActivityAt: string } | null;
};

type Asset = {
  id: string;
  order: number;
  filename: string | null;
  uploaded: boolean;
  url: string | null;
};

/** 열거형 필드는 드롭다운으로만 고칠 수 있게 해 잘못된 값이 들어가지 않게 한다. */
const ENUM_OPTIONS: Record<
  string,
  { values: readonly string[]; labels: Record<string, string> }
> = {
  gender: { values: GENDERS, labels: GENDER_LABELS },
  jobCategory: { values: JOB_CATEGORIES, labels: JOB_CATEGORY_LABELS },
  residenceRegion: { values: REGIONS, labels: REGION_LABELS },
  workplaceRegion: { values: REGIONS, labels: REGION_LABELS },
  religion: { values: RELIGIONS, labels: RELIGION_LABELS },
  smoking: { values: SMOKING_LEVELS, labels: SMOKING_LABELS },
  drinking: { values: DRINKING_LEVELS, labels: DRINKING_LABELS },
  mbti: { values: MBTI_TYPES, labels: Object.fromEntries(MBTI_TYPES.map((m) => [m, m])) },
};

const LONG_TEXT_FIELDS = new Set(["bio", "idealTypeText"]);
const NUMBER_FIELDS = new Set(["birthYear", "height"]);

export function ImportReview({
  session,
  assets,
  extraction,
  groups,
}: {
  session: Session;
  assets: Asset[];
  extraction: Extraction | null;
  /** 주선자가 속한 모임 전부. 여기서 등록될 방을 고른다. */
  groups: GroupChoice[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    toStringMap(extraction?.fields),
  );
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [text, setText] = useState(session.rawText ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const committed = session.committedProfileId != null;
  const [groupId, setGroupId] = useState<string | null>(session.groupId);

  /**
   * 등록될 방을 바꾼다. 즉시 저장한다 — 「검토 저장」은 추출 필드만 다루고,
   * 이 값은 세션 자체의 것이라 같이 묶으면 어느 쪽이 저장됐는지 헷갈린다.
   */
  async function moveGroup(next: string | null) {
    const previous = groupId;
    setGroupId(next);
    setBusy("group");
    setError(null);
    setMessage(null);
    const result = await apiPatch(`/api/imports/${session.id}/group`, { groupId: next });
    setBusy(null);
    if (result.ok) {
      setMessage(
        next
          ? `${groups.find((g) => g.id === next)?.name ?? "선택한 모임"} 에 등록합니다.`
          : "전체공개로 등록합니다.",
      );
      router.refresh();
    } else {
      setGroupId(previous);
      setError(result.message);
    }
  }

  function edit(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setDirty((prev) => new Set(prev).add(key));
  }

  async function saveText() {
    setBusy("text");
    setError(null);
    const result = await apiPatch(`/api/imports/${session.id}/text`, { rawText: text });
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMessage("원문을 저장했습니다.");
    router.refresh();
  }

  async function analyze() {
    setBusy("analyze");
    setError(null);
    setMessage(null);
    const result = await apiPost(`/api/imports/${session.id}/analyze`);
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  async function saveReview() {
    if (dirty.size === 0) return;
    setBusy("review");
    setError(null);
    const patch: Record<string, unknown> = {};
    for (const key of dirty) {
      patch[key] = parseFieldValue(key, values[key] ?? "");
    }
    const result = await apiPatch(`/api/imports/${session.id}/extraction`, { fields: patch });
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDirty(new Set());
    setMessage("검토 내용을 저장했습니다.");
    router.refresh();
  }

  async function commit(publish: boolean) {
    setBusy("commit");
    setError(null);
    // 같은 세션의 commit 은 같은 키를 쓴다 — 중복 클릭이 프로필을 두 개 만들지 않는다.
    const result = await apiPost<{ profileId: string; reused: boolean }>(
      `/api/imports/${session.id}/commit`,
      { idempotencyKey: `import-${session.id}`, publish },
    );
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.push(`/profiles/${result.data.profileId}`);
  }

  const attention = extraction?.review.filter((f) => f.needsAttention) ?? [];

  return (
    <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
      {/* 원본 */}
      <div className="flex flex-col gap-5">
        <Panel
          tight
          title="원본"
          action={
            <Badge tone={toneForStatus(session.status)}>
              {label.importStatus(session.status)}
            </Badge>
          }
        >
          {session.errorMessage ? (
            <p className="mb-3 rounded-md bg-[var(--color-danger)]/8 px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
              {session.errorMessage}
            </p>
          ) : null}

          <p className="mb-2 text-[12px] text-[var(--surface-text-muted)]">
            출처 {label.importSource(session.source)} · 사진 {assets.length}장
          </p>

          {session.telegram ? (
            <p className="mb-2 text-[12px] text-[var(--surface-text-muted)]">
              봇 대화 {session.telegram.state} · 시작{" "}
              {new Date(session.telegram.startedAt).toLocaleString("ko-KR")} · 마지막 메시지{" "}
              {new Date(session.telegram.lastActivityAt).toLocaleString("ko-KR")}
            </p>
          ) : null}

          {assets.length > 0 ? (
            <div className="mb-4 grid grid-cols-3 gap-2">
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  className="relative aspect-3/4 overflow-hidden rounded bg-[var(--surface-muted)]"
                >
                  {asset.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={asset.url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center px-1 text-center text-[10px] text-[var(--color-danger)]">
                      업로드 실패
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          {!committed ? <RetryUpload sessionId={session.id} nextOrder={assets.length} /> : null}

          <div className="mt-4">
            <p className="mb-1.5 text-[12px] font-medium">
              프로필 글
              {!session.rawText ? (
                <span className="ml-1.5 font-normal text-[var(--color-warning)]">
                  · 카카오톡에서 복사한 글을 붙여넣으면 정확도가 올라갑니다
                </span>
              ) : null}
            </p>
            <Textarea
              value={text}
              disabled={committed}
              maxLength={20000}
              onChange={(e) => setText(e.target.value)}
              className="min-h-44 text-[12.5px]"
            />
            {!committed ? (
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy != null || text === (session.rawText ?? "")}
                  onClick={() => void saveText()}
                >
                  원문 저장
                </Button>
                <Button size="sm" disabled={busy != null} onClick={() => void analyze()}>
                  {busy === "analyze" ? "분석 중…" : extraction ? "다시 분석" : "AI 분석"}
                </Button>
              </div>
            ) : null}
          </div>
        </Panel>
      </div>

      {/* 등록할 곳 + AI 결과 + 검토 */}
      <div className="flex flex-col gap-5">
        <Panel tight title="등록할 모임">
          <GroupPicker
            groups={groups}
            value={groupId}
            disabled={committed || busy != null}
            // 전체공개로 되돌리는 것은 이 건을 가져온 주선자만 할 수 있다.
            allowPublic={session.canUsePublic}
            onChange={(next) => void moveGroup(next)}
          />
          <p className="mt-2.5 text-[12px] leading-relaxed text-[var(--surface-text-muted)]">
            {committed
              ? "이미 등록했습니다. 옮기려면 프로필 화면에서 다뤄야 합니다."
              : "여기서 고른 방에 프로필이 만들어집니다. 방을 바꾸면 이 건은 그 방의 가져오기 목록으로 옮겨 갑니다."}
          </p>
        </Panel>

        {extraction == null ? (
          <Panel title="AI 결과">
            <p className="py-8 text-center text-[13px] text-[var(--surface-text-muted)]">
              아직 분석하지 않았습니다. 왼쪽에서 「AI 분석」을 눌러주세요.
            </p>
          </Panel>
        ) : (
          <>
            {extraction.notes.length > 0 ? (
              <div className="rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/8 px-4 py-3">
                <p className="mb-1.5 text-[12.5px] font-medium text-[var(--color-warning)]">
                  확인이 필요합니다
                </p>
                <ul className="flex flex-col gap-1">
                  {extraction.notes.map((note) => (
                    <li key={note} className="text-[12.5px] text-[var(--surface-text)]">
                      · {note}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Panel
              tight
              title="추출 결과"
              action={
                <span className="text-[11.5px] text-[var(--surface-text-muted)]">
                  {extraction.model} · {extraction.promptVersion}
                </span>
              }
            >
              <p className="mb-3 text-[12px] text-[var(--surface-text-muted)]">
                신뢰도 {Math.round(LOW_CONFIDENCE_THRESHOLD * 100)}% 미만이거나 비어 있는 필수
                항목은 강조됩니다. 값을 고치면 검토 완료로 표시됩니다.
              </p>

              <div className="grid gap-2.5 sm:grid-cols-2">
                {extraction.review.map((field) => (
                  <FieldRow
                    key={field.key}
                    field={field}
                    value={values[field.key] ?? ""}
                    dirty={dirty.has(field.key)}
                    disabled={committed}
                    onChange={(v) => edit(field.key, v)}
                  />
                ))}
              </div>
            </Panel>

            {error ? <p className="text-[13px] text-[var(--color-danger)]">{error}</p> : null}
            {message ? (
              <p className="text-[13px] text-[var(--color-success)]">{message}</p>
            ) : null}

            {committed ? (
              <div className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)] px-4 py-3 text-[13px]">
                이미 프로필로 등록된 세션입니다.
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={busy != null || dirty.size === 0}
                  onClick={() => void saveReview()}
                >
                  {busy === "review"
                    ? "저장 중…"
                    : `검토 저장${dirty.size > 0 ? ` (${dirty.size})` : ""}`}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy != null || dirty.size > 0}
                  onClick={() => void commit(false)}
                >
                  비공개로 등록
                </Button>
                <Button
                  disabled={busy != null || dirty.size > 0 || attention.length > 0}
                  onClick={() => void commit(true)}
                >
                  {busy === "commit" ? "등록 중…" : "등록하고 공개"}
                </Button>

                {dirty.size > 0 ? (
                  <span className="text-[12px] text-[var(--surface-text-muted)]">
                    수정한 내용을 먼저 저장해 주세요.
                  </span>
                ) : attention.length > 0 ? (
                  <span className="text-[12px] text-[var(--color-warning)]">
                    확인이 필요한 항목이 {attention.length}개 있어 바로 공개할 수 없습니다.
                  </span>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FieldRow({
  field,
  value,
  dirty,
  disabled,
  onChange,
}: {
  field: FieldReview;
  value: string;
  dirty: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const enumOptions = ENUM_OPTIONS[field.key];
  const percent = Math.round(field.confidence * 100);

  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2.5",
        dirty
          ? "border-[var(--surface-accent)] bg-[var(--surface-accent)]/5"
          : field.needsAttention
            ? "border-[var(--color-warning)]/45 bg-[var(--color-warning)]/6"
            : "border-[var(--surface-border)]",
      )}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium">
          {FIELD_LABELS[field.key] ?? field.key}
          {field.required ? <span className="ml-1 text-[var(--color-danger)]">*</span> : null}
        </span>
        <span
          className={cn(
            "text-[11px]",
            field.needsAttention
              ? "text-[var(--color-warning)]"
              : "text-[var(--surface-text-muted)]",
          )}
        >
          {dirty ? "수정함" : value === "" ? "비어 있음" : `${percent}%`}
        </span>
      </div>

      {enumOptions ? (
        <Select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-[12.5px]"
        >
          <option value="">선택 안 함</option>
          {enumOptions.values.map((option) => (
            <option key={option} value={option}>
              {enumOptions.labels[option] ?? option}
            </option>
          ))}
        </Select>
      ) : LONG_TEXT_FIELDS.has(field.key) ? (
        <Textarea
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-16 text-[12.5px]"
        />
      ) : (
        <Input
          value={value}
          disabled={disabled}
          inputMode={NUMBER_FIELDS.has(field.key) ? "numeric" : "text"}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-[12.5px]"
        />
      )}
    </div>
  );
}

/** 업로드에 실패한 사진을 다시 올린다(모바일 가이드 「신뢰성」). */
function RetryUpload({ sessionId, nextOrder }: { sessionId: string; nextOrder: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        disabled={busy}
        className="w-full text-[12px] file:mr-2 file:rounded file:border file:border-[var(--surface-border)] file:bg-white file:px-2 file:py-1 file:text-[12px]"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length === 0) return;
          void (async () => {
            setBusy(true);
            setError(null);
            for (const [index, file] of files.entries()) {
              const slot = await apiPost<{ assetId: string; uploadUrl: string }>(
                `/api/imports/${sessionId}/assets`,
                {
                  type: "IMAGE",
                  filename: file.name,
                  mimeType: file.type,
                  size: file.size,
                  order: nextOrder + index,
                },
              );
              if (!slot.ok) {
                setError(slot.message);
                break;
              }
              const uploaded = await uploadFile(slot.data.uploadUrl, file);
              if (!uploaded.ok) {
                setError(uploaded.message);
                break;
              }
              await apiPost(`/api/imports/${sessionId}/assets`, { confirm: slot.data.assetId });
            }
            setBusy(false);
            router.refresh();
          })();
        }}
      />
      {error ? <p className="mt-1 text-[11.5px] text-[var(--color-danger)]">{error}</p> : null}
    </div>
  );
}

function toStringMap(fields: Record<string, unknown> | undefined): Record<string, string> {
  if (!fields) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value == null) out[key] = "";
    else if (Array.isArray(value)) out[key] = value.join(", ");
    else out[key] = String(value);
  }
  return out;
}

/** 문자열 입력을 스키마가 기대하는 타입으로 되돌린다. 빈 값은 null 이다. */
function parseFieldValue(key: string, raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (NUMBER_FIELDS.has(key)) {
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : null;
  }
  if (key === "hobbies") {
    const items = trimmed
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return items.length > 0 ? items : null;
  }
  return trimmed;
}

