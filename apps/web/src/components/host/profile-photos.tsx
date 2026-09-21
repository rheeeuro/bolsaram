"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ImageCropper } from "@/components/ui/image-cropper";
import { apiDelete, apiPatch, apiPost, uploadFile } from "@/lib/api-client";

type Image = { id: string; url: string; isPrimary: boolean };

/**
 * 프로필 사진 관리.
 *
 * Import 로 들어온 뒤에도 사진은 바뀐다 — 대면에서 「이 사진 말고 다른 걸로」가
 * 나온다. 추가·대표 지정·삭제를 여기서 한다.
 *
 * 삭제는 되돌릴 수 없으므로 한 번 더 묻는다. 대표 지정은 되돌릴 수 있어 바로 적용한다.
 *
 * 고른 사진은 **한 장씩 영역을 정한 뒤** 올라간다(`ImageCropper`). 목록 카드와 상세가
 * 세로 3:4 로 잘라 보여주기 때문에, 자리를 맡기면 얼굴이 잘린 카드가 그대로 남는다.
 * 여러 장을 골랐으면 차례로 묻고, 전부 정한 뒤에 한꺼번에 올린다.
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
  /** 아직 영역을 정하지 않은 사진들. 맨 앞이 지금 묻고 있는 장이다. */
  const [queue, setQueue] = useState<File[]>([]);
  /** 영역을 정해 둔 사진들. 큐가 비는 순간 한꺼번에 올라간다. */
  const [cropped, setCropped] = useState<File[]>([]);

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

  /** 이번 장을 마치고 다음 장으로. 마지막 장이면 모아 둔 것을 올린다. */
  function next(file: File) {
    const rest = queue.slice(1);
    const done = [...cropped, file];
    setQueue(rest);
    if (rest.length > 0) {
      setCropped(done);
      return;
    }
    setCropped([]);
    void upload(done);
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
        <ul className="mb-3 grid grid-cols-2 gap-2">
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
                      className="h-7 flex-1 whitespace-nowrap px-2 text-[11.5px]"
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
                      className="h-7 whitespace-nowrap px-2 text-[11.5px]"
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
                      className="h-7 flex-1 whitespace-nowrap px-2 text-[11.5px]"
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
                    className="h-7 whitespace-nowrap px-2 text-[11.5px]"
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
          if (files.length > 0) {
            setError(null);
            setCropped([]);
            setQueue(files);
          }
        }}
      />
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]">
        고르면 쓸 영역을 정한 뒤 올라갑니다. 첫 사진이 대표가 됩니다. 장당 25MB 까지.
      </p>

      {queue[0] ? (
        <ImageCropper
          file={queue[0]}
          aspect={3 / 4}
          shape="square"
          step={{ current: cropped.length + 1, total: cropped.length + queue.length }}
          onCancel={() => {
            // 한 장을 그만두면 나머지도 그만둔다 — 남은 장만 올라가면 무엇이 빠졌는지 모른다.
            setQueue([]);
            setCropped([]);
          }}
          onApply={next}
        />
      ) : null}

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
