/** 시그널 — 받은/보낸/연결된 (설계문서 §6). */
import { withRls } from "@bolsaram/db";
import { requireUserPage, rlsContextOf } from "@/server/auth/guard";
import { Empty } from "@/components/ui/empty";
import { listSignals, type SignalDirection } from "@/server/repo/matches";
import { listPendingIntentsForProfile } from "@/server/repo/match-intents";
import { findProfilesByIds } from "@/server/repo/profiles";
import { toCardView } from "@/server/views/profile-view";
import { SignalTabs } from "@/components/member/signal-tabs";
import { MemberHeader } from "@/components/member/member-header";

export const dynamic = "force-dynamic";

const DIRECTIONS: SignalDirection[] = ["incoming", "outgoing", "connected"];

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const viewer = await requireUserPage("/signals");
  const { tab } = await searchParams;
  const direction: SignalDirection = DIRECTIONS.includes(tab as SignalDirection)
    ? (tab as SignalDirection)
    : "incoming";

  if (!viewer.profileId) {
    return (
      <PageShell>
        <Empty
          title="아직 연결된 프로필이 없어요"
          description="주선자에게 받은 초대 링크로 본인 프로필을 연결하면 시그널을 주고받을 수 있습니다."
        />
      </PageShell>
    );
  }

  const profileId = viewer.profileId;
  const items = await withRls(rlsContextOf(viewer), async (sql) => {
    const signals = await listSignals(sql, profileId, direction);
    // 주선자 확인을 기다리는 요청(0026). 이것이 없으면 회원은 방금 누른 것이 어디로
    // 갔는지 알 수 없다 — 신청은 승인된 뒤에야 생기기 때문이다.
    const pending = await listPendingIntentsForProfile(sql, profileId);
    const pendingByRequest = new Map(
      pending
        .filter((intent) => intent.matchRequestId != null)
        .map((intent) => [intent.matchRequestId!, intent]),
    );
    // 아직 신청이 없는 「마음 보내기」는 보낸 탭에 요청 그대로 세운다.
    const pendingSends =
      direction === "outgoing"
        ? pending.filter((intent) => intent.kind === "SEND" && intent.targetProfileId != null)
        : [];

    const otherIds = [
      ...signals.map((s) =>
        s.requesterProfileId === profileId ? s.targetProfileId : s.requesterProfileId,
      ),
      ...pendingSends.map((intent) => intent.targetProfileId!),
    ];
    const profiles = await findProfilesByIds(sql, [...new Set(otherIds)]);
    const byId = new Map(profiles.map((p) => [p.id, p]));

    const fromSignals = signals.map((signal) => {
      const otherId =
        signal.requesterProfileId === profileId
          ? signal.targetProfileId
          : signal.requesterProfileId;
      const other = byId.get(otherId);
      return {
        id: signal.id,
        status: signal.status,
        message: signal.message,
        introduceNote: signal.introduceNote,
        requestedAt: signal.requestedAt.toISOString(),
        isRequester: signal.requesterProfileId === profileId,
        profile: other ? toCardView(other) : null,
        pendingKind: pendingByRequest.get(signal.id)?.kind ?? null,
      };
    });

    const fromIntents = pendingSends.map((intent) => {
      const other = byId.get(intent.targetProfileId!);
      return {
        id: intent.id,
        status: "REQUESTED",
        message: intent.message,
        introduceNote: null,
        requestedAt: intent.createdAt.toISOString(),
        isRequester: true,
        profile: other ? toCardView(other) : null,
        pendingKind: intent.kind,
      };
    });

    return [...fromIntents, ...fromSignals];
  });

  return (
    <PageShell>
      <SignalTabs direction={direction} items={items} />
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemberHeader title="시그널" />
      <main className="mx-auto max-w-3xl px-4">{children}</main>
    </>
  );
}
