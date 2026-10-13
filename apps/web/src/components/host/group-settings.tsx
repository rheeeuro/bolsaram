"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  GROUP_CHAT_NOTIFY_LABELS,
  GROUP_CHAT_NOTIFY_MODES,
  GROUP_NAME_MAX_LENGTH,
  type GroupChatNotifyMode,
} from "@bolsaram/schemas";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/host/surface";
import { GroupInviteIssuer } from "@/components/host/group-menu";
import { ImagePicker } from "@/components/host/image-picker";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Field, FormError, Input, Textarea } from "@/components/ui/field";
import { apiDelete, apiPatch } from "@/lib/api-client";
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
 *   모임 정리  모임 나가기 · 모임 폐쇄
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
  /** 소속이 아니라 관리자로서 보고 있다 — 모임장과 같은 권한, 나가기는 없다. */
  asOperator: boolean;
  memberCount: number;
  importCount: number;
  /** 내가 등록한 활성 프로필 수. 나가면 모두 비활성이 된다. */
  myActiveCount: number;
  admins: Admin[];
  /** 이 방의 채팅 텔레그램 알림. 사람마다 따로이고 기본은 멘션만이다. */
  chatNotify: GroupChatNotifyMode;
  /** 텔레그램을 연결했는가. 연결해야 알림을 고를 수 있다. */
  telegramLinked: boolean;
};

const TABS = [
  { key: "overview", label: "개요" },
  { key: "admins", label: "주선자" },
  { key: "notify", label: "알림" },
  { key: "danger", label: "모임 정리" },
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
          <Stat
            label="내 역할"
            value={group.asOperator ? "관리자" : group.isOwner ? "모임장" : "주선자"}
          />
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
  return (
    <>
      <Panel title="주선자">
        {group.admins.length === 0 ? (
          <p className="text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
            아직 주선자가 없습니다. 아래 초대 코드로 동료를 들인 뒤 모임장을 넘겨 주세요.
          </p>
        ) : null}
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
        <GroupInviteIssuer
          groupId={group.groupId}
          buttonLabel="주선자 초대 코드 받기"
          compact
        />
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
  // 관리자는 어느 모임에서든 모임장과 같은 일을 한다.
  const canManage = (group.isOwner || group.asOperator) && !isMe;

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
              message={
                group.asOperator
                  ? `${name} 님이 이 모임의 모임장이 됩니다.`
                  : `${name} 님이 모임장이 되고 나는 보통 주선자가 됩니다. 되돌리려면 그분이 다시 넘겨야 합니다.`
              }
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
              message={`${name} 님은 이 모임의 멤버를 더 이상 볼 수 없고, ${name} 님이 등록한 프로필은 모두 비활성이 됩니다. 다시 들어오려면 초대 코드가 필요합니다.`}
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

/** 고를 때 옆에 붙는 설명. */
const NOTIFY_HINTS: Record<GroupChatNotifyMode, string> = {
  ALL: "이 방에 새 글이 올라올 때마다 알립니다(내가 쓴 글 제외).",
  MENTIONS: "누가 나를 @이름 으로 멘션했을 때만 알립니다.",
  OFF: "텔레그램으로는 보내지 않습니다. 채팅 버튼의 숫자로만 봅니다.",
};

/**
 * 이 방의 채팅 알림 — 모든 새 메시지 · 멘션만(기본) · 알림 끄기.
 *
 * 모임 단위이면서 사람 단위다. 보내는 것은 「새 글이 있다」 「나를 멘션했다」 한 줄이고
 * 내용은 싣지 않는다. 텔레그램을 연결해야 보낼 곳이 생기므로, 연결 전에는 고를 수
 * 없게 두고 연결하는 곳으로 안내한다(서버도 같은 판정으로 막는다).
 */
function ChatNotify({ group }: { group: Group }) {
  const router = useRouter();
  const [mode, setMode] = useState(group.chatNotify);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = group.telegramLinked;

  async function choose(next: GroupChatNotifyMode) {
    if (next === mode || saving) return;
    const previous = mode;
    setMode(next);
    setSaving(true);
    setError(null);
    const result = await apiPatch(`/api/admin/groups/${group.groupId}/chat`, { notify: next });
    setSaving(false);
    if (result.ok) router.refresh();
    else {
      setMode(previous);
      setError(result.message);
    }
  }

  return (
    <Panel title="채팅 알림">
      {enabled ? null : (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--surface-muted)] px-4 py-3">
          <p className="text-[12.5px] leading-relaxed text-[var(--surface-text)]">
            채팅 알림은 텔레그램으로 갑니다. 먼저 텔레그램을 연결해 주세요.
          </p>
          <Link
            href="/account"
            className="shrink-0 text-[12.5px] font-medium text-[var(--color-rose-600)] underline-offset-4 hover:underline"
          >
            텔레그램 연결하기 →
          </Link>
        </div>
      )}

      <fieldset disabled={!enabled || saving} className="grid gap-2">
        <legend className="sr-only">텔레그램으로 받을 채팅 알림</legend>
        {GROUP_CHAT_NOTIFY_MODES.map((option) => (
          <label
            key={option}
            className={cn(
              "flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors",
              enabled ? "cursor-pointer" : "cursor-not-allowed opacity-55",
              mode === option && enabled
                ? "border-[var(--color-rose-400)] bg-[var(--color-rose-100)]/40"
                : "border-[var(--surface-border)]",
            )}
          >
            <input
              type="radio"
              name={`chat-notify-${group.groupId}`}
              value={option}
              checked={mode === option}
              onChange={() => void choose(option)}
              className="mt-1 h-3.5 w-3.5 accent-[var(--color-rose-600)]"
            />
            <span className="text-[13px] leading-relaxed text-[var(--surface-text)]">
              {GROUP_CHAT_NOTIFY_LABELS[option]}
              {option === "MENTIONS" ? (
                <span className="ml-1.5 text-[11.5px] text-[var(--surface-text-muted)]">기본</span>
              ) : null}
              <span className="mt-0.5 block text-[11.5px] text-[var(--surface-text-muted)]">
                {NOTIFY_HINTS[option]}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="mt-3 text-[11.5px] text-[var(--surface-text-muted)]">
        내용은 보내지 않고 알림 한 줄만 갑니다. 이 설정은 나에게만 적용되고, 같은 모임의 다른
        주선자는 각자 고릅니다.
      </p>
      <FormError>{error}</FormError>
    </Panel>
  );
}

/** 되돌리기 어려운 것들 — 나가기와 폐쇄. */
function DangerZone({ group }: { group: Group }) {
  return (
    <>
      {/* 관리자는 속하지 않았으므로 나갈 것이 없다. */}
      {group.asOperator ? null : <LeaveGroup group={group} />}
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
      description="나가면 이 모임의 멤버가 보이지 않고, 내가 등록한 프로필은 모두 비활성이 됩니다. 다시 들어오면 직접 활성으로 되돌립니다. 마지막 주선자라면 멤버가 남아 있는 동안 나갈 수 없습니다."
      error={error}
    >
      <ConfirmButton
        variant="danger"
        label={busy ? "나가는 중…" : "모임 나가기"}
        confirmLabel="나가기"
        message={`「${group.name}」 의 멤버가 더 이상 보이지 않습니다.${
          group.myActiveCount > 0
            ? ` 내가 등록한 ${group.myActiveCount}명은 비활성이 되어 멤버 목록에서 빠집니다.`
            : ""
        } 다시 들어오려면 초대 코드가 필요합니다.`}
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

  if (!group.isOwner && !group.asOperator) {
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
        description={`${left.join(" · ")}이 남아 있어 폐쇄할 수 없습니다. 남은 프로필과 가져오기를 정리한 뒤 다시 시도해 주세요.`}
        error={null}
      />
    );
  }

  // 관리자는 주선자 목록에 없으므로 빠지는 사람은 목록 전부다.
  const others = group.asOperator ? group.admins.length : group.admins.length - 1;

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

/** 모임 정리 탭의 한 칸. 무슨 일이 벌어지는지 먼저 읽히게 문장이 버튼보다 앞에 온다. */
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
