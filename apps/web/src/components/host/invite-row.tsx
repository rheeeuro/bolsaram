"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/ui/copy-field";
import { Thumb } from "@/components/host/surface";
import { apiPost } from "@/lib/api-client";

/**
 * 초대를 기다리는 분 한 줄.
 *
 * 초대 발급은 주선자의 핵심 동작인데, 예전에는 이 목록에서 프로필 상세로 넘어가
 * 오른쪽 사이드바(모바일에서는 맨 아래)까지 내려가야 버튼이 있었다. 「회원」 화면이
 * 초대를 위해 있는데 정작 초대를 할 수 없었다. 여기서 바로 낸다.
 *
 * 발급된 값은 이 자리에서 한 번만 보인다 — 서버는 해시만 갖는다.
 */
export function InviteRow({
  profileId,
  code,
  name,
  imageUrl,
  expiresAt,
  claimedAt,
}: {
  profileId: string;
  code: number;
  name: string | null;
  imageUrl: string | null;
  expiresAt: string | null;
  claimedAt: string | null;
}) {
  const router = useRouter();
  const [issued, setIssued] = useState<{ url: string; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="px-5 py-3.5">
      <div className="flex items-center gap-4">
        <Link
          href={`/profiles/${profileId}`}
          className="flex min-w-0 flex-1 items-center gap-4 transition-opacity hover:opacity-80"
        >
          <Thumb url={imageUrl} size="sm" />
          <span className="min-w-0">
            <span className="display block text-[15px] text-[var(--surface-text)]">
              #{code}
            </span>
            <span className="block truncate text-[12.5px] text-[var(--surface-text-muted)]">
              {name ?? "이름 없음"}
            </span>
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-3">
          <State expiresAt={expiresAt} claimedAt={claimedAt} />
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true);
                setError(null);
                const result = await apiPost<{ url: string; code: string }>(
                  "/api/admin/invites",
                  { profileId, expiresInHours: 72 },
                );
                setBusy(false);
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                setIssued({ url: result.data.url, code: result.data.code });
                router.refresh();
              })();
            }}
          >
            {busy ? "발급 중…" : expiresAt ? "다시 발급" : "초대 발급"}
          </Button>
        </div>
      </div>

      {issued ? (
        <div className="mt-3 flex flex-col gap-2.5 rounded-[10px] bg-[var(--color-ivory-100)] p-3">
          <p className="text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]">
            지금만 볼 수 있습니다. 복사해서 카카오톡으로 보내세요. 둘은 같은 것이고,
            링크를 못 여는 분에게만 코드를 보냅니다.
          </p>
          <CopyField label="초대 링크" value={issued.url} />
          <CopyField label="입장코드" value={issued.code} />
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 text-[12px] text-[var(--color-danger)]">{error}</p>
      ) : null}
    </li>
  );
}

/** 발급 이력 상태. 만료 여부는 화면에서 계산한다. */
function State({
  expiresAt,
  claimedAt,
}: {
  expiresAt: string | null;
  claimedAt: string | null;
}) {
  if (!expiresAt) return <Badge tone="neutral">미발급</Badge>;
  if (claimedAt) return <Badge tone="active">사용됨</Badge>;
  const expires = new Date(expiresAt);
  if (expires.getTime() < Date.now()) return <Badge tone="danger">만료</Badge>;
  return (
    <span className="hidden text-[12.5px] text-[var(--surface-text-muted)] sm:inline">
      {expires.toLocaleDateString("ko-KR")}까지
    </span>
  );
}
