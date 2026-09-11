"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/host/surface";
import { Field, Textarea } from "@/components/ui/field";
import { GroupPicker, type GroupChoice } from "@/components/host/group-picker";
import { apiPost, uploadFile } from "@/lib/api-client";

type Slot = { assetId: string; order: number; uploadUrl: string };
type Created = { id: string; assets: Slot[] };

/**
 * 새 Import 만들기.
 *
 * fallback 네 갈래를 한 화면에 둔다(모바일 가이드 「Fallback UX」).
 * 사진만 / 글만 / 둘 다 / 아무것도 없음 — 어떤 조합이든 진행할 수 있고,
 * 무엇이 빠졌는지 즉시 알려준다.
 *
 * **어느 방에 넣을지를 여기서 정한다.** 지금 보고 있는 방이 골라진 채로 시작하지만
 * 보내기 전에 눈에 보이고, 서버도 이 값을 반드시 받는다 — 조용히 정해지지 않는다.
 */
export function NewImportPanel({
  groups,
  activeGroupId,
}: {
  groups: GroupChoice[];
  activeGroupId: string | null;
}) {
  const router = useRouter();
  const [groupId, setGroupId] = useState<string | null>(activeGroupId);
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasImages = files.length > 0;
  const hasText = text.trim().length > 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      setProgress("세션 만드는 중…");
      const created = await apiPost<Created>("/api/imports", {
        source: hasImages ? "MANUAL_UPLOAD" : "TEXT",
        groupId,
        ...(hasText ? { rawText: text } : {}),
        assets: files.map((file, index) => ({
          filename: file.name,
          mimeType: file.type,
          size: file.size,
          order: index,
        })),
      });
      if (!created.ok) {
        setError(created.message);
        return;
      }

      // 이미지는 signed URL 로 직접 올린다. 실패한 장은 남기고 나머지는 계속 진행한다.
      const failed: string[] = [];
      for (const [index, slot] of created.data.assets.entries()) {
        const file = files[index];
        if (!file) continue;
        setProgress(`사진 업로드 ${index + 1}/${files.length}`);
        const uploaded = await uploadFile(slot.uploadUrl, file);
        if (!uploaded.ok) {
          failed.push(file.name);
          continue;
        }
        await apiPost(`/api/imports/${created.data.id}/assets`, { confirm: slot.assetId });
      }

      if (failed.length > 0) {
        setError(
          `${failed.length}장을 올리지 못했습니다. 검토 화면에서 다시 시도할 수 있습니다.`,
        );
      }

      setProgress("AI 분석 중…");
      const analyzed = await apiPost(`/api/imports/${created.data.id}/analyze`);
      // 분석에 실패해도 세션은 남는다. 검토 화면에서 재시도한다.
      if (!analyzed.ok) setError(analyzed.message);

      router.push(`/imports/${created.data.id}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <Panel title="새로 가져오기">
      <Field label="등록할 모임" hint="여기 고른 방에 프로필이 만들어집니다">
        <GroupPicker
          groups={groups}
          value={groupId}
          disabled={busy}
          onChange={setGroupId}
        />
      </Field>

      <div className="mt-4" />

      <Field label="사진" hint="카카오톡에서 받은 프로필 사진 (여러 장 선택 가능)">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          multiple
          disabled={busy}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="w-full text-[12.5px] file:mr-3 file:rounded-md file:border file:border-[var(--surface-border)] file:bg-white file:px-3 file:py-1.5 file:text-[12.5px]"
        />
      </Field>

      {hasImages ? (
        <p className="mt-1.5 text-[12px] text-[var(--surface-text-muted)]">
          사진 {files.length}장을 가져왔어요.
          {!hasText ? " 카카오톡에서 복사한 글도 아래에 붙여넣어 주세요." : ""}
        </p>
      ) : null}

      <div className="mt-4">
        <Field label="프로필 글" hint={hasImages ? "선택" : "사진이 없으면 필수"}>
          <Textarea
            placeholder={
              "카카오톡에서 복사한 프로필 글을 붙여넣으세요.\n\n예)\n93년생 / 여자\n키 167\n마케터, 서울"
            }
            value={text}
            maxLength={20000}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            className="min-h-40 text-[13px]"
          />
        </Field>
      </div>

      {error ? <p className="mt-3 text-[12.5px] text-[var(--color-danger)]">{error}</p> : null}
      {progress ? (
        <p className="mt-3 text-[12.5px] text-[var(--surface-text-muted)]">{progress}</p>
      ) : null}

      <Button
        className="mt-4 w-full"
        disabled={busy || (!hasImages && !hasText)}
        onClick={() => void submit()}
      >
        {busy ? "처리 중…" : "AI로 프로필 만들기"}
      </Button>

      <p className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]">
        AI 결과는 자동으로 게시되지 않습니다. 다음 화면에서 확인하고 수정한 뒤 등록하세요.
      </p>
    </Panel>
  );
}
