"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { PROFILE_IMAGE_MAX_COUNT } from "@bolsaram/schemas";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/host/surface";
import { Field, Textarea } from "@/components/ui/field";
import { GroupPicker, type GroupChoice } from "@/components/host/group-picker";
import { apiPost, uploadFile } from "@/lib/api-client";
import { cn } from "@/lib/cn";

type Slot = { assetId: string; order: number; uploadUrl: string };

/** 한 번에 올릴 수 있는 사진 수. 서버 스키마(`createImportSessionSchema`)와 같다. */
const MAX_FILES = 20;
const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
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
  const [notice, setNotice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 붙여넣기 리스너는 한 번 붙여 두므로 최신 장수를 ref 로 읽는다.
  const countRef = useRef(0);
  countRef.current = files.length;

  /**
   * 사진을 **덧붙인다**. 카카오톡에서 여러 번에 나눠 고르는 일이 흔해서 다시 고르면
   * 앞의 것이 사라지는 기본 동작을 쓰지 않는다. 형식이 다르거나 넘치는 장은 이유를 말한다.
   */
  const addFiles = useCallback((incoming: File[]) => {
    const images = incoming.filter(
      (file) => ACCEPT.includes(file.type) || /\.(heic|heif)$/i.test(file.name),
    );
    const skipped = incoming.length - images.length;
    const taken = images.slice(0, Math.max(0, MAX_FILES - countRef.current));
    const over = images.length - taken.length;
    setNotice(
      [
        skipped > 0 ? `사진이 아닌 파일 ${skipped}개는 뺐습니다.` : null,
        over > 0 ? `한 번에 ${MAX_FILES}장까지라 ${over}장은 넣지 않았습니다.` : null,
      ]
        .filter(Boolean)
        .join(" ") || null,
    );
    if (taken.length > 0) setFiles((prev) => [...prev, ...taken]);
  }, []);

  // 카카오톡 PC 에서 사진을 복사해 Ctrl+V 로 붙여넣을 수 있게 한다. 글 붙여넣기는
  // 그대로 두고, 클립보드에 사진이 있을 때만 가로챈다.
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      if (busy) return;
      const pasted = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (pasted.length === 0) return;
      const hasText = (event.clipboardData?.getData("text/plain") ?? "").length > 0;
      if (!hasText) event.preventDefault();
      addFiles(pasted);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [busy, addFiles]);

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

      <Field label="사진" hint={`앞의 ${PROFILE_IMAGE_MAX_COUNT}장이 프로필 사진이 됩니다`}>
        <PhotoDrop
          files={files}
          disabled={busy}
          onAdd={addFiles}
          onRemove={(index) => {
            setNotice(null);
            setFiles((prev) => prev.filter((_, i) => i !== index));
          }}
        />
      </Field>

      {notice ? (
        <p className="mt-1.5 text-[12px] text-[var(--color-warning)]">{notice}</p>
      ) : hasImages && !hasText ? (
        <p className="mt-1.5 text-[12px] text-[var(--surface-text-muted)]">
          카카오톡에서 복사한 글도 아래에 붙여넣어 주세요.
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

/**
 * 사진 고르는 자리. 누르면 고르기, 끌어다 놓기, Ctrl+V 붙여넣기 모두 받는다.
 * 고른 사진은 순서대로 작게 보여 주고 한 장씩 뺄 수 있다 — 앞에서부터 프로필 사진이
 * 되므로 순서가 보여야 한다.
 */
function PhotoDrop({
  files,
  disabled,
  onAdd,
  onRemove,
}: {
  files: File[];
  disabled: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
}) {
  const inputId = useId();
  const [over, setOver] = useState(false);
  const [previews, setPreviews] = useState<string[]>([]);

  // 미리보기 주소는 파일이 바뀔 때마다 새로 만들고 이전 것은 풀어 준다.
  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) onAdd(Array.from(e.dataTransfer.files));
      }}
      className={cn(
        "rounded-[12px] border border-dashed p-2.5 transition-colors duration-[var(--duration-quick)]",
        over
          ? "border-[var(--color-rose-500)] bg-[var(--color-rose-100)]/60"
          : "border-[var(--surface-border)] bg-[var(--color-ivory-100)]",
      )}
    >
      <input
        id={inputId}
        type="file"
        accept={ACCEPT.join(",")}
        multiple
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          onAdd(Array.from(e.target.files ?? []));
          // 같은 사진을 다시 골라도 change 가 나도록 비운다.
          e.target.value = "";
        }}
      />

      {files.length === 0 ? (
        <label
          htmlFor={inputId}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-1 rounded-[9px] px-3 py-5 text-center",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <span className="text-[13px] font-medium text-[var(--surface-text)]">사진 고르기</span>
          <span className="text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]">
            여러 장 한 번에 · PC에서는 끌어다 놓거나 복사한 사진을 Ctrl+V
          </span>
        </label>
      ) : (
        <ul className="grid grid-cols-4 gap-1.5">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
              className="relative aspect-3/4 overflow-hidden rounded-[8px] bg-[var(--color-ivory-200)]"
            >
              {previews[index] ? (
                // 로컬 미리보기(blob:)라 next/image 를 태우지 않는다. HEIC 처럼 브라우저가
                // 그리지 못하는 형식은 빈 칸에 파일 이름이 비친다.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previews[index]} alt={file.name} className="h-full w-full object-cover" />
              ) : null}
              {index < PROFILE_IMAGE_MAX_COUNT ? (
                <span className="absolute left-1 top-1 rounded bg-[var(--color-burgundy-900)]/70 px-1 text-[10px] text-white">
                  {index + 1}
                </span>
              ) : null}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemove(index)}
                aria-label={`${index + 1}번째 사진 빼기`}
                className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-[var(--color-ink-900)]/60 text-[12px] leading-none text-white"
              >
                ×
              </button>
            </li>
          ))}
          {files.length < MAX_FILES ? (
            <li>
              <label
                htmlFor={inputId}
                className={cn(
                  "flex aspect-3/4 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[8px] border border-[var(--surface-border)] bg-white text-[var(--surface-text-muted)]",
                  disabled && "cursor-not-allowed opacity-60",
                )}
              >
                <span className="text-[18px] leading-none">＋</span>
                <span className="text-[11px]">더 넣기</span>
              </label>
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
