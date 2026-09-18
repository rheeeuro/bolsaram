"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonClasses } from "@/components/ui/button";
import { apiDelete, apiPost, uploadFile } from "@/lib/api-client";
import { cn } from "@/lib/cn";

/**
 * 사진 하나를 올리고 지우는 자리 — 내 프로필 사진과 모임 사진이 같은 물건을 쓴다.
 *
 * 올리는 것은 두 단계다(슬롯 → 확정). 파일이 실제로 올라간 뒤에만 계정·모임에 붙으므로
 * 중간에 실패해도 깨진 사진이 남지 않는다. 지우는 것은 되돌릴 수 있는 일이 아니지만
 * **원래 상태(앞글자)로 돌아가는 것뿐**이라 확인 단계를 두지 않는다.
 *
 * 사람은 동그랗게, 모임은 모서리를 둥글린 네모로 그린다 — 화면 어디서나 둘을 같은
 * 모양으로 두지 않아 한눈에 갈린다.
 */
export function ImagePicker({
  endpoint,
  url,
  name,
  shape,
  hint,
}: {
  /** 슬롯·확정·삭제를 모두 받는 경로. 예) `/api/admin/me/avatar` */
  endpoint: string;
  /** 지금 사진의 단기 signed URL. 없으면 앞글자를 그린다. */
  url: string | null;
  name: string;
  shape: "circle" | "square";
  hint: string;
}) {
  const router = useRouter();
  const inputId = useId();
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy("upload");
    setError(null);

    const slot = await apiPost<{ key: string; uploadUrl: string }>(endpoint, {
      mimeType: file.type,
      size: file.size,
    });
    if (!slot.ok) {
      setBusy(null);
      setError(slot.message);
      return;
    }

    const sent = await uploadFile(slot.data.uploadUrl, file);
    if (!sent.ok) {
      setBusy(null);
      setError(sent.message);
      return;
    }

    const confirmed = await apiPost(endpoint, {
      confirm: { key: slot.data.key, mimeType: file.type },
    });
    setBusy(null);
    if (!confirmed.ok) {
      setError(confirmed.message);
      return;
    }
    router.refresh();
  }

  async function remove() {
    setBusy("remove");
    setError(null);
    const result = await apiDelete(endpoint);
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  const rounded = shape === "circle" ? "rounded-full" : "rounded-2xl";

  return (
    <div>
      <div className="flex items-center gap-4">
        <Avatar
          src={url}
          name={name}
          className={cn(
            "grid size-16 shrink-0 place-items-center bg-[var(--color-rose-100)]",
            "text-[22px] font-semibold text-[var(--color-burgundy-800)]",
            rounded,
          )}
        />

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor={inputId}
              className={buttonClasses({
                variant: "secondary",
                size: "sm",
                className: busy ? "cursor-not-allowed opacity-60" : "cursor-pointer",
              })}
            >
              {url ? "사진 바꾸기" : "사진 올리기"}
            </label>
            {url ? (
              <Button size="sm" variant="ghost" disabled={busy != null} onClick={() => void remove()}>
                지우기
              </Button>
            ) : null}
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]">
            {hint}
          </p>
        </div>
      </div>

      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        disabled={busy != null}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />

      {busy ? (
        <p role="status" className="mt-2 text-[11.5px] text-[var(--surface-text-muted)]">
          {busy === "upload" ? "올리는 중…" : "지우는 중…"}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[11.5px] text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
