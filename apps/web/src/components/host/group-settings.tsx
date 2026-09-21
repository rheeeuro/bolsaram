"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { GROUP_NAME_MAX_LENGTH } from "@bolsaram/schemas";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/host/surface";
import { ImagePicker } from "@/components/host/image-picker";
import { CopyField } from "@/components/ui/copy-field";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Field, FormError, Input, Textarea } from "@/components/ui/field";
import { apiDelete, apiPatch, apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";

/**
 * 모임 하나의 설정 화면.
 *
 * **모임 안에 있는 화면이다.** 사이드바에서 그 모임을 고른 채로 들어오고, 여기서
 * 다루는 것은 전부 이 모임 하나에 대한 것이다 — 다른 모임을 고치려면 그 모임으로
 * 옮겨 간다. 목록을 늘어놓고 카드마다 폼을 펼치던 자리를 대신한다.
 *
 * 네 묶음으로 가른다. 자주 여는 것(이름·동료)이 앞이고 되돌리기 어려운 것이 맨 뒤다.
 *
 *   개요     사진·이름·설명
 *   주선자   구성원 목록 · 초대 코드 · 모임장 넘기기 · 내보내기
 *   알림     이 방의 채팅을 텔레그램으로도 받을지 (사람마다 따로)
 *   위험     모임 나가기 · 모임 폐쇄
 *
 * 모임장에게만 보이는 것이 있다 — 주선자 목록의 조작 버튼과 폐쇄다. 다른 사람의
 * 소속이나 방 자체를 건드리는 자리라 다른 주선자에게는 버튼을 그리지 않고, 서버도
 * 같은 판정을 다시 한다.
 */

type Admin = { userId: string; displayName: string | null; isOwner: boolean };
export type Group = {
  groupId: string;
  name: string;
  description: string | null;
  /** 모임 사진의 단기 signed URL. 없으면 모임 이름의 앞글자를 그린다. */
  imageUrl: string | null;
  isOwner: boolean;
  memberCount: number;
  importCount: number;
  admins: Admin[];
  /** 이 방의 새 채팅을 텔레그램으로도 받는 중인가. 사람마다 따로다. */
  chatNotify: boolean;
};

const TABS = [
  { key: "overview", label: "개요" },
  { key: "admins", label: "주선자" },
  { key: "notify", label: "알림" },
  { key: "danger", label: "위험 구역" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function GroupSettings({
  group,
  viewerUserId,
}: {
  group: Group;
  /** 보고 있는 사람. 주선자 목록에서 자기 자신에게는 조작 버튼을 그리지 않는다. */
  viewerUserId: string;
}) {
  const [tab, setTab] = useState<TabKey>("overview");

  return (
    <div className="grid max-w-3xl gap-4">
      <div
        role="tablist"
        aria-label="모임 설정"
        className="flex gap-1 overflow-x-auto border-b border-[var(--surface-border)]"
      >
        {TABS.map((item) => {
          const active = item.key === tab;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              id={`group-tab-${item.key}`}
              aria-selected={active}
              aria-controls={`group-panel-${item.key}`}
              onClick={() => setTab(item.key)}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-3.5 py-2 text-[13px] transition-colors",
                active
                  ? "border-[var(--color-rose-600)] text-[var(--color-rose-600)]"
                  : "border-transparent text-[var(--surface-text-muted)] hover:text-[var(--surface-text)]",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`group-panel-${tab}`}
        aria-labelledby={`group-tab-${tab}`}
        className="grid gap-4"
      >
        {tab === "overview" ? <Overview group={group} /> : null}
        {tab === "admins" ? <GroupAdmins group={group} viewerUserId={viewerUserId} /> : null}
        {tab === "notify" ? <ChatNotify group={group} /> : null}
        {tab === "danger" ? <DangerZone group={group} /> : null}
      </div>
    </div>
  );
}

/** 사진·이름·설명 수정. 설명은 주선자끼리만 보는 메모다. */
function Overview({ group }: { group: Group }) {
  const router = useRouter();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = name !== group.name || description !== (group.description ?? "");

  return (
    <>
      <Panel title="모임 정보">
        <div className="mb-4 border-b border-[var(--surface-border)] pb-4">
          <ImagePicker
            endpoint={`/api/admin/groups/${group.groupId}/image`}
            url={group.imageUrl}
            name={group.name}
            shape="square"
            hint="모임 목록에 보입니다. 지우면 모임 이름의 앞글자가 보입니다."
          />
        </div>

        <Field label="모임 이름" hint={`${GROUP_NAME_MAX_LENGTH}자까지`}>
          <Input
            value={name}
            maxLength={GROUP_NAME_MAX_LENGTH}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="mt-3">
          <Field label="설명" hint="주선자끼리만 봅니다">
            <Textarea
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-20 text-[12.5px]"
            />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button
            size="sm"
            disabled={busy || !dirty || name.trim().length === 0}
            onClick={() =>
              void (async () => {
                setBusy(true);
                setError(null);
                setMessage(null);
                const result = await apiPatch(`/api/admin/groups/${group.groupId}`, {
                  name,
                  description,
                });
                setBusy(false);
                if (result.ok) {
                  setMessage("저장했습니다.");
                  router.refresh();
                } else {
                  setError(result.message);
                }
              })()
            }
          >
            {busy ? "저장 중…" : "저장"}
          </Button>
          {message ? (
            <span className="text-[12.5px] text-[var(--surface-text-muted)]">{message}</span>
          ) : null}
        </div>
        <FormError>{error}</FormError>
      </Panel>

      <Panel title="이 모임에 있는 것">
        <dl className="grid grid-cols-2 gap-3 text-[13px]">
          <Stat label="멤버" value={`${group.memberCount}명`} />
          <Stat label="주선자" value={`${group.admins.length}명`} />
          <Stat label="가져오기" value={`${group.importCount}건`} />
          <Stat label="내 역할" value={group.isOwner ? "모임장" : "주선자"} />
        </dl>
      </Panel>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-[var(--surface-border)] px-3 py-2">
      <dt className="text-[11.5px] text-[var(--surface-text-muted)]">{label}</dt>
      <dd className="mt-0.5 text-[14px] text-[var(--surface-text)]">{value}</dd>
    </div>
  );
}

/**
 * 동료 주선자 목록과 초대 코드 발급. 코드는 발급 직후 한 번만 보인다.
 *
 * 모임장에게는 각 줄에 「모임장 넘기기」·「내보내기」가 붙는다. 초대 코드가 잘못
 * 전달됐을 때 되돌릴 수 있는 유일한 자리라 목록 안에 둔다 — 누구를 빼는지 이름을
 * 보면서 누르게 한다.
 */
function GroupAdmins({ group, viewerUserId }: { group: Group; viewerUserId: string }) {
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Panel title="주선자">
        <ul className="grid gap-1.5">
          {group.admins.map((admin) => (
            <AdminRow
              key={admin.userId}
              group={group}
              admin={admin}
              isMe={admin.userId === viewerUserId}
            />
          ))}
        </ul>
      </Panel>

      <Panel title="동료 초대">
        <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
          코드를 받아 동료에게 전달하세요. <b>24시간·1회용</b>이고 발급 직후 한 번만
          보입니다. 새로 발급하면 내가 만들어 둔 이전 코드는 쓸 수 없습니다.
        </p>
        {issued ? (
          <div className="space-y-2">
            <CopyField value={issued.code} />
            <p className="text-[11.5px] text-[var(--surface-text-muted)]">
              {new Date(issued.expiresAt).toLocaleString("ko-KR")} 까지
            </p>
          </div>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void (async () => {
                setBusy(true);
                setError(null);
                const result = await apiPost<{ code: string; expiresAt: string }>(
                  `/api/admin/groups/${group.groupId}/invite`,
                );
                setBusy(false);
                if (result.ok) setIssued(result.data);
                else setError(result.message);
              })()
            }
          >
            {busy ? "발급 중…" : "주선자 초대 코드 받기"}
          </Button>
        )}
        <FormError>{error}</FormError>
      </Panel>
    </>
  );
}

/**
 * 주선자 한 줄. 모임장이 남을 볼 때만 조작 버튼이 붙는다.
 *
 * 자기 자신에게는 아무것도 그리지 않는다 — 모임장이 빠지는 것은 「모임 나가기」이고,
 * 그쪽은 남은 주선자에게 모임장을 넘기는 일까지 함께 한다.
 */
function AdminRow({ group, admin, isMe }: { group: Group; admin: Admin; isMe: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = admin.displayName ?? "이름 없음";
  const canManage = group.isOwner && !isMe;

  async function send(run: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true);
    setError(null);
    const result = await run();
    setBusy(false);
    if (result.ok) router.refresh();
    else setError(result.message ?? "요청을 처리하지 못했습니다.");
  }

  return (
    <li className="rounded-[10px] border border-[var(--surface-border)] px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] text-[var(--surface-text)]">
          {name}
          {admin.isOwner ? (
            <span className="ml-1.5 text-[11.5px] text-[var(--surface-text-muted)]">모임장</span>
          ) : null}
          {isMe ? (
            <span className="ml-1.5 text-[11.5px] text-[var(--surface-text-muted)]">나</span>
          ) : null}
        </span>

        {canManage ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <ConfirmButton
              label="모임장 넘기기"
              confirmLabel="넘기기"
              message={`${name} 님이 모임장이 되고 나는 보통 주선자가 됩니다. 되돌리려면 그분이 다시 넘겨야 합니다.`}
              disabled={busy}
              onConfirm={() =>
                void send(() =>
                  apiPatch(`/api/admin/groups/${group.groupId}/admins/${admin.userId}`, {
                    isOwner: true,
                  }),
                )
              }
            />
            <ConfirmButton
              variant="danger"
              label="내보내기"
              confirmLabel="내보내기"
              message={`${name} 님은 이 모임의 멤버를 더 이상 볼 수 없습니다. 다시 들어오려면 초대 코드가 필요합니다.`}
              disabled={busy}
              onConfirm={() =>
                void send(() =>
                  apiDelete(`/api/admin/groups/${group.groupId}/admins/${admin.userId}`),
                )
              }
            />
          </span>
        ) : null}
      </div>
      <FormError>{error}</FormError>
    </li>
  );
}

/**
 * 이 방의 채팅 알림. 기본은 화면 배지뿐이고, 켜면 텔레그램으로도 온다.
 *
 * 모임 단위이면서 사람 단위다 — 같은 방이라도 켠 사람에게만 나간다. 보내는 것은
 * 「새 글이 있다」 한 줄이고 내용은 싣지 않는다.
 */
function ChatNotify({ group }: { group: Group }) {
  const router = useRouter();
  const [on, setOn] = useState(group.chatNotify);
  const [error, setError] = useState<string | null>(null);

  return (
    <Panel title="채팅 알림">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={on}
          className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-rose-600)]"
          onChange={() =>
            void (async () => {
              const next = !on;
              setOn(next);
              setError(null);
              const result = await apiPatch(`/api/admin/groups/${group.groupId}/chat`, {
                telegramNotify: next,
              });
              if (result.ok) router.refresh();
              else {
                setOn(!next);
                setError(result.message);
              }
            })()
          }
        />
        <span className="text-[12.5px] leading-relaxed text-[var(--surface-text)]">
          이 모임의 새 채팅을 텔레그램으로도 받기
          <span className="mt-1 block text-[11.5px] text-[var(--surface-text-muted)]">
            내용은 보내지 않고 새 글이 있다는 것만 알립니다. 봇을 연결해야 도착합니다 —
            계정 설정의 「텔레그램 연결」에서 연결합니다.
          </span>
        </span>
      </label>
      <p className="mt-3 text-[11.5px] text-[var(--surface-text-muted)]">
        이 설정은 나에게만 적용됩니다. 같은 모임의 다른 주선자는 각자 켭니다.
      </p>
      <FormError>{error}</FormError>
    </Panel>
  );
}

/** 되돌리기 어려운 것들 — 나가기와 폐쇄. */
function DangerZone({ group }: { group: Group }) {
  return (
    <>
      <LeaveGroup group={group} />
      <CloseGroup group={group} />
    </>
  );
}

/** 모임 나가기. 마지막 주선자는 멤버가 남아 있는 동안 나갈 수 없다(서버가 막는다). */
function LeaveGroup({ group }: { group: Group }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <DangerPanel
      title="모임 나가기"
      description="나가면 이 모임의 멤버가 보이지 않습니다. 다시 들어오려면 초대 코드가 필요합니다. 마지막 주선자라면 멤버가 남아 있는 동안 나갈 수 없습니다."
      error={error}
    >
      <ConfirmButton
        variant="danger"
        label={busy ? "나가는 중…" : "모임 나가기"}
        confirmLabel="나가기"
        message={`「${group.name}」 의 멤버가 더 이상 보이지 않습니다. 다시 들어오려면 초대 코드가 필요합니다.`}
        disabled={busy}
        onConfirm={() =>
          void (async () => {
            setBusy(true);
            setError(null);
            const result = await apiDelete(`/api/admin/groups/${group.groupId}`);
            setBusy(false);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            router.replace("/home");
            router.refresh();
          })()
        }
      />
    </DangerPanel>
  );
}

/**
 * 모임 폐쇄. 모임장만, 그리고 **비어 있을 때만**.
 *
 * 남아 있는 것이 있으면 버튼을 그리지 않고 무엇이 남았는지 적는다 — 눌러 보고 나서
 * 거절당하는 것보다 먼저 아는 편이 낫다. 세는 것과 막는 것은 서버가 다시 한다.
 */
function CloseGroup({ group }: { group: Group }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!group.isOwner) {
    return (
      <DangerPanel
        title="모임 폐쇄"
        description="모임장만 모임을 폐쇄할 수 있습니다."
        error={null}
      />
    );
  }

  const left = [
    group.memberCount > 0 ? `멤버 ${group.memberCount}명` : null,
    group.importCount > 0 ? `가져오기 ${group.importCount}건` : null,
  ].filter(Boolean);

  if (left.length > 0) {
    return (
      <DangerPanel
        title="모임 폐쇄"
        description={`${left.join(" · ")}이 남아 있어 폐쇄할 수 없습니다. 전체공개로 옮기거나 정리한 뒤 다시 시도해 주세요.`}
        error={null}
      />
    );
  }

  const others = group.admins.length - 1;

  return (
    <DangerPanel
      title="모임 폐쇄"
      description={
        others > 0
          ? `이 모임을 없앱니다. 남아 있는 주선자 ${others}명도 함께 빠집니다. 되돌릴 수 없습니다.`
          : "이 모임을 없앱니다. 되돌릴 수 없습니다."
      }
      error={error}
    >
      <ConfirmButton
        variant="danger"
        label={busy ? "폐쇄하는 중…" : "모임 폐쇄"}
        confirmLabel="폐쇄"
        message={`「${group.name}」 이 사라집니다. 채팅 기록과 초대 코드도 함께 없어지고 되돌릴 수 없습니다.`}
        disabled={busy}
        onConfirm={() =>
          void (async () => {
            setBusy(true);
            setError(null);
            const result = await apiDelete(`/api/admin/groups/${group.groupId}/close`);
            setBusy(false);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            router.replace("/home");
            router.refresh();
          })()
        }
      />
    </DangerPanel>
  );
}

/** 위험 구역의 한 칸. 무슨 일이 벌어지는지 먼저 읽히게 문장이 버튼보다 앞에 온다. */
function DangerPanel({
  title,
  description,
  error,
  children,
}: {
  title: string;
  description: string;
  error: string | null;
  children?: ReactNode;
}) {
  return (
    <Panel title={title} className="border-[var(--color-rose-200)]">
      <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
        {description}
      </p>
      {children}
      <FormError>{error}</FormError>
    </Panel>
  );
}
