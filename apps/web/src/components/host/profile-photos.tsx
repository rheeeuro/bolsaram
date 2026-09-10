"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { apiDelete, apiPatch, apiPost, uploadFile } from "@/lib/api-client";

type Image = { id: string; url: string; isPrimary: boolean };

/**
 * 프로필 사진 관리.
 *
 * Import 로 들어온 뒤에도 사진은 바뀐다 — 대면에서 「이 사진 말고 다른 걸로」가
 * 나온다. 추가·대표 지정·삭제를 여기서 한다.
 *
 * 삭제는 되돌릴 수 없으므로 한 번 더 묻는다. 대표 지정은 되돌릴 수 있어 바로 적용한다.
 */
export function ProfilePhotos({
  profileId,
  images,
}: {
  profileId: string;
  images: Image[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function upload(files: File[]) {
    setError(null);
    for (const [index, file] of files.entries()) {
      setBusy(`올리는 중 ${index + 1}/${files.length}`);
      const slot = await apiPost<{ key: string; uploadUrl: string }>(
        `/api/profiles/${profileId}/images`,
        { mimeType: file.type, size: file.size },
      );
      if (!slot.ok) {
        setError(slot.message);
        break;
      }
      const sent = await uploadFile(slot.data.uploadUrl, file);
      if (!sent.ok) {
        setError(sent.message);
        break;
      }
      // 파일이 실제로 올라간 뒤에만 프로필에 붙는다.
      const confirmed = await apiPost(`/api/profiles/${profileId}/images`, {
        confirm: { key: slot.data.key, mimeType: file.type },
      });
      if (!confirmed.ok) {
        setError(confirmed.message);
        break;
      }
    }
    setBusy(null);
    router.refresh();
  }

  async function act(label: string, run: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(label);
    setError(null);
    const result = await run();
    setBusy(null);
    if (!result.ok) {
      setError(result.message ?? "처리하지 못했습니다.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {images.length === 0 ? (
        <p className="mb-3 text-[12.5px] text-[var(--surface-text-muted)]">
          등록된 사진이 없습니다.
        </p>
      ) : (
        <ul className="mb-3 grid grid-cols-3 gap-2">
          {images.map((image) => (
            <li key={image.id}>
              <div className="relative aspect-3/4 overflow-hidden rounded-[10px] bg-[var(--color-ivory-200)]">
                {/* signed URL 은 응답마다 새로 발급된다 — next/image 최적화를 태우지 않는다. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt="" className="h-full w-full object-cover" />
                {image.isPrimary ? (
                  <span className="absolute left-1 top-1 rounded bg-[var(--color-burgundy-900)]/75 px-1.5 py-0.5 text-[10px] text-white">
                    대표
                  </span>
                ) : null}
              </div>

              {confirming === image.id ? (
                <div className="mt-1.5">
                  <p className="mb-1 text-[11px] leading-snug text-[var(--color-danger)]">
                    지웁니다. 되돌릴 수 없습니다.
                  </p>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy != null}
                      className="h-7 flex-1 px-2 text-[11.5px]"
                      onClick={() => {
                        setConfirming(null);
                        void act("delete", () =>
                          apiDelete(`/api/profiles/${profileId}/images/${image.id}`),
                        );
                      }}
                    >
                      삭제
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11.5px]"
                      onClick={() => setConfirming(null)}
                    >
                      취소
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-1.5 flex gap-1">
                  {!image.isPrimary ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy != null}
                      className="h-7 flex-1 px-2 text-[11.5px]"
                      onClick={() =>
                        void act("primary", () =>
                          apiPatch(`/api/profiles/${profileId}/images/${image.id}`, {
                            primary: true,
                          }),
                        )
                      }
                    >
                      대표로
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy != null}
                    className="h-7 px-2 text-[11.5px]"
                    onClick={() => setConfirming(image.id)}
                  >
                    삭제
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        disabled={busy != null}
        className="w-full text-[12px] file:mr-2 file:rounded file:border file:border-[var(--surface-border)] file:bg-white file:px-2 file:py-1 file:text-[12px]"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0) void upload(files);
        }}
      />
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]">
        첫 사진이 대표가 됩니다. 장당 25MB 까지.
      </p>

      {busy ? (
        <p className="mt-2 text-[11.5px] text-[var(--surface-text-muted)]">
          {busy.startsWith("올리는") ? busy : "처리 중…"}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-[11.5px] text-[var(--color-danger)]">{error}</p>
      ) : null}
    </div>
  );
}
