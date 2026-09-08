"use client";

/**
 * 등록 동의 기록 (마이그레이션 0019).
 *
 * 프로필은 주선자가 남을 대신해 등록한다. 공개하려면 본인에게 확인했다는 기록이
 * 있어야 하고, 그 기록을 남기는 자리가 여기다. **어떻게 확인했는지는 운영이 정하고,
 * 화면은 무엇을 확인했는지만 받는다.**
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CONSENT_METHOD_LABELS,
  RECORDABLE_CONSENT_METHODS,
  type ConsentMethod,
} from "@bolsaram/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/admin/table";
import { Field, Input, Select } from "@/components/ui/field";
import { apiPost } from "@/lib/api-client";

/** 로컬 시간대로 `datetime-local` 이 받는 형식을 만든다(UTC 로 밀리지 않게). */
function nowForInput(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

export function ConsentPanel({
  profileId,
  consent,
}: {
  profileId: string;
  consent: { method: string | null; confirmedAt: string | null } | undefined;
}) {
  const router = useRouter();
  const method = (consent?.method ?? null) as ConsentMethod | null;
  const confirmed = method !== null && method !== "SYNTHETIC" && method !== "LEGACY";

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    method: "KAKAO" as (typeof RECORDABLE_CONSENT_METHODS)[number],
    confirmedAt: nowForInput(),
    note: "",
  });

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await apiPost(`/api/profiles/${profileId}/consent`, {
      method: form.method,
      // datetime-local 은 시간대가 없다. 브라우저 시간대로 해석해 offset 을 붙인다.
      confirmedAt: new Date(form.confirmedAt).toISOString(),
      note: form.note,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <Card title="등록 동의">
      <div className="mb-3 flex items-center gap-2">
        <Badge tone={confirmed ? "active" : "warning"}>
          {method ? CONSENT_METHOD_LABELS[method] : "기록 없음"}
        </Badge>
        {consent?.confirmedAt ? (
          <span className="text-[12px] text-[var(--surface-text-muted)]">
            {new Date(consent.confirmedAt).toLocaleDateString("ko-KR")}
          </span>
        ) : null}
      </div>

      {!confirmed ? (
        <p className="mb-3 text-[12.5px] text-[var(--surface-text-muted)]">
          {method === "SYNTHETIC"
            ? "합성 데이터입니다. 공개할 수 없습니다."
            : "본인에게 확인했다는 기록이 없으면 공개할 수 없습니다."}
        </p>
      ) : null}

      {method === "SYNTHETIC" ? null : open ? (
        <div className="flex flex-col gap-2">
          <Field label="확인 방법">
            <Select
              value={form.method}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  method: e.target.value as (typeof RECORDABLE_CONSENT_METHODS)[number],
                }))
              }
            >
              {RECORDABLE_CONSENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {CONSENT_METHOD_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="확인한 시각">
            <Input
              type="datetime-local"
              value={form.confirmedAt}
              max={nowForInput()}
              onChange={(e) => setForm((p) => ({ ...p, confirmedAt: e.target.value }))}
            />
          </Field>
          <Field label="메모" hint="대화 내용을 옮겨 적지 마세요">
            <Input
              value={form.note}
              maxLength={500}
              placeholder="예: 본인에게 전체공개 범위까지 안내함"
              onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
            />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void submit()}>
              기록하기
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              취소
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="w-full" onClick={() => setOpen(true)}>
          {confirmed ? "다시 기록하기" : "동의 기록하기"}
        </Button>
      )}

      {error ? <p className="mt-2 text-[12px] text-[var(--color-danger)]">{error}</p> : null}
    </Card>
  );
}
