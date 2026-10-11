"use client";

import { useState } from "react";
import { PROFILE_MEMO_MAX } from "@bolsaram/schemas";
import { Button } from "@/components/ui/button";
import { FormError, Textarea } from "@/components/ui/field";
import { Panel } from "@/components/host/surface";
import { apiPut } from "@/lib/api-client";

type Memo = { body: string; updatedAt: string };

function savedAt(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 등록한 주선자만 보는 메모. 담당일 때만 그린다.
 *
 * 자동 저장하지 않는다 — 적다 만 글이 저장되면 「저장했나」를 다시 확인해야 한다.
 * 저장은 그 자리에서 끝나고 화면을 새로 그리지 않는다.
 */
export function ProfileMemo({ profileId, memo }: { profileId: string; memo: Memo | null }) {
  const [saved, setSaved] = useState<Memo | null>(memo);
  const [draft, setDraft] = useState(memo?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = draft.trim() !== (saved?.body ?? "");
  const near = draft.length > PROFILE_MEMO_MAX * 0.9;

  async function save() {
    setBusy(true);
    setError(null);
    const result = await apiPut<{ memo: Memo | null }>(`/api/profiles/${profileId}/memo`, {
      body: draft,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSaved(result.data.memo);
    setDraft(result.data.memo?.body ?? "");
  }

  return (
    <Panel title="메모">
      <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
        나만 보는 메모입니다. 같은 모임 주선자도, 이 분 본인도 보지 못합니다.
      </p>
      <Textarea
        aria-label="메모"
        value={draft}
        maxLength={PROFILE_MEMO_MAX}
        rows={5}
        placeholder="만난 경위, 성향, 소개할 때 챙길 것"
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <span className="text-[11.5px] text-[var(--surface-text-muted)]">
          {near
            ? `${draft.length} / ${PROFILE_MEMO_MAX}자`
            : dirty
              ? "저장하지 않은 내용이 있습니다"
              : saved
                ? `저장됨 · ${savedAt(saved.updatedAt)}`
                : null}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          {busy ? "저장 중" : "저장"}
        </Button>
      </div>
      <FormError>{error}</FormError>
    </Panel>
  );
}
