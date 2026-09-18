/** 시그널 — 받은/보낸/연결된 (설계문서 §6). */
import { withRls } from "@bolsaram/db";
import { requireUserPage, rlsContextOf } from "@/server/auth/guard";
import { Empty } from "@/components/ui/empty";
import {
  listSignals,
  type MatchRequestRecord,
  type SignalDirection,
} from "@/server/repo/matches";
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
  const groups = await withRls(rlsContextOf(viewer), async (sql) => {
    // 세 방향을 한 번에 읽는다 — 탭 전환은 화면에서 일어나고 서버를 다시 부르지
    // 않는다. 한 사람의 시그널은 세 방향을 합쳐도 적다. 커넥션 하나를 쓰므로
    // 동시에 던지지 않고 차례로 읽는다.
    const byDirection: Record<SignalDirection, MatchRequestRecord[]> = {
      incoming: [],
      outgoing: [],
      connected: [],
    };
    for (const d of DIRECTIONS) byDirection[d] = await listSignals(sql, profileId, d);

    // 주선자 확인을 기다리는 요청(0026). 이것이 없으면 멤버는 방금 누른 것이 어디로
    // 갔는지 알 수 없다 — 신청은 승인된 뒤에야 생기기 때문이다.
    const pending = await listPendingIntentsForProfile(sql, profileId);
    const pendingByRequest = new Map(
      pending
        .filter((intent) => intent.matchRequestId != null)
        .map((intent) => [intent.matchRequestId!, intent]),
    );
    // 아직 신청이 없는 「마음 보내기」는 보낸 탭에 요청 그대로 세운다.
    const pendingSends = pending.filter(
      (intent) => intent.kind === "SEND" && intent.targetProfileId != null,
    );

    const otherOf = (signal: MatchRequestRecord) =>
      signal.requesterProfileId === profileId
        ? signal.targetProfileId
        : signal.requesterProfileId;

    const otherIds = [
      ...DIRECTIONS.flatMap((d) => byDirection[d].map(otherOf)),
      ...pendingSends.map((intent) => intent.targetProfileId!),
    ];
    const profiles = await findProfilesByIds(sql, [...new Set(otherIds)]);
    const byId = new Map(profiles.map((p) => [p.id, p]));

    const toItem = (signal: MatchRequestRecord) => {
      const other = byId.get(otherOf(signal));
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
    };

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

    return {
      incoming: byDirection.incoming.map(toItem),
      outgoing: [...fromIntents, ...byDirection.outgoing.map(toItem)],
      connected: byDirection.connected.map(toItem),
    };
  });

  return (
    <PageShell>
      <SignalTabs initialTab={direction} groups={groups} />
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
