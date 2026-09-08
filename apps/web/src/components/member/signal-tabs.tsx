"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { label } from "@/lib/labels";
import { MatchMoment } from "@/components/member/match-moment";
import type { ProfileCardView } from "@/server/views/profile-view";

export type SignalItem = {
  id: string;
  status: string;
  message: string | null;
  introduceNote: string | null;
  requestedAt: string;
  isRequester: boolean;
  profile: ProfileCardView | null;
};

const TABS = [
  { key: "incoming", label: "받은" },
  { key: "outgoing", label: "보낸" },
  { key: "connected", label: "이어짐" },
] as const;

const EMPTY_COPY: Record<string, { title: string; description: string }> = {
  incoming: {
    title: "아직 받은 시그널이 없어요",
    description: "누군가 마음을 보내면 여기에서 확인할 수 있습니다.",
  },
  outgoing: {
    title: "보낸 시그널이 없어요",
    description: "마음에 드는 분의 프로필에서 소개를 신청해보세요.",
  },
  connected: {
    title: "아직 이어진 인연이 없어요",
    description: "서로 마음이 닿으면 주선자가 두 분을 연결해드립니다.",
  },
};

export function SignalTabs({ direction, items }: { direction: string; items: SignalItem[] }) {
  return (
    <>
      <div className="sticky top-[57px] z-10 -mx-4 flex gap-1.5 bg-[var(--surface-page)]/95 px-4 py-3 backdrop-blur">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/signals?tab=${tab.key}`}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              direction === tab.key
                ? "bg-[var(--color-ink-900)] text-white"
                : "border border-[var(--surface-border)] bg-white text-[var(--color-ink-600)]",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <Empty {...(EMPTY_COPY[direction] ?? EMPTY_COPY.incoming!)} />
      ) : (
        <ul className="flex flex-col gap-2.5 pb-8">
          {items.map((item) => (
            <SignalRow key={item.id} item={item} direction={direction} />
          ))}
        </ul>
      )}
    </>
  );
}

function SignalRow({ item, direction }: { item: SignalItem; direction: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matched, setMatched] = useState(false);

  async function act(action: "accept" | "reject" | "cancel") {
    setBusy(true);
    setError(null);
    const result = await apiPost(`/api/match-requests/${item.id}/${action}`);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // 수락은 감정의 정점이다. 연출을 닫을 때 목록을 갱신한다 —
    // 먼저 갱신하면 이 행이 「이어짐」 탭으로 사라지면서 연출도 같이 사라진다.
    if (action === "accept") {
      setMatched(true);
      return;
    }
    router.refresh();
  }

  return (
    <li className="rounded-[var(--radius-card)] border border-[var(--surface-border)] bg-white p-3.5">
      <div className="flex gap-3">
        <Link
          href={
            item.profile
              ? `/discover/${item.profile.id}?from=signals&tab=${direction}`
              : "#"
          }
          className="h-18 w-14 shrink-0 overflow-hidden rounded-lg bg-[var(--color-ivory-200)]"
        >
          {item.profile?.primaryImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.profile.primaryImage.url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : null}
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="display text-[15px] text-[var(--color-ink-900)]">
              {item.profile?.code ?? "비공개"}
            </span>
            <Badge tone={toneForStatus(item.status)}>{label.matchStatus(item.status)}</Badge>
          </div>

          {item.profile ? (
            <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-600)]">
              {item.profile.birthYear}년생 · {label.region(item.profile.residenceRegion)}
            </p>
          ) : null}

          {item.message ? (
            <p className="mt-2 rounded-lg bg-[var(--color-ivory-100)] px-3 py-2 text-[13px] leading-relaxed text-[var(--color-ink-800)]">
              {item.message}
            </p>
          ) : null}

          {item.introduceNote ? (
            <p className="mt-2 rounded-lg bg-[var(--color-rose-100)] px-3 py-2 text-[13px] leading-relaxed text-[var(--color-burgundy-800)]">
              {item.introduceNote}
            </p>
          ) : null}

          {error ? (
            <p className="mt-2 text-[12px] text-[var(--color-danger)]">{error}</p>
          ) : null}

          {direction === "incoming" && item.status === "REQUESTED" ? (
            <div className="mt-3 flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => void act("accept")}>
                수락하기
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void act("reject")}
              >
                정중히 거절
              </Button>
            </div>
          ) : null}

          {direction === "outgoing" && item.status === "REQUESTED" ? (
            <div className="mt-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void act("cancel")}
              >
                신청 취소
              </Button>
            </div>
          ) : null}

          {item.status === "ACCEPTED" ? (
            <p className="mt-2.5 text-[12.5px] text-[var(--color-ink-600)]">
              서로 마음이 닿았어요. 주선자가 곧 연결해드립니다.
            </p>
          ) : null}
        </div>
      </div>

      <MatchMoment
        open={matched}
        variant="matched"
        onClose={() => {
          setMatched(false);
          router.refresh();
        }}
      />
    </li>
  );
}
