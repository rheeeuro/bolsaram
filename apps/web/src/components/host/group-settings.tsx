"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/host/surface";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/field";
import { CopyField } from "@/components/ui/copy-field";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { apiDelete, apiPatch, apiPost, apiPut } from "@/lib/api-client";
import { cn } from "@/lib/cn";

/**
 * 모임 관리.
 *
 * 한 주선자가 **여러 모임에 동시에 속한다.** 이 화면은 지금 고를 수 있는 방을 전부
 * 한 줄씩 늘어놓는다 — 상단 전환기에 뜨는 것과 같은 목록이고, **전체공개도 한 칸을
 * 차지한다.** 어디서 일하고 있는지가 먼저 읽히고, 고치는 것은 그다음이다.
 *
 * 그래서 카드는 접힌 채로 시작한다. 이름·설명 수정, 동료 초대 코드, 나가기는 전부
 * 「설정」 안에 있다 — 모임이 서너 개만 돼도 폼이 화면을 가득 채우기 때문이다.
 * 만들기와 참여도 늘 펼쳐 두지 않고 버튼 → 창으로 옮겼다.
 */

type Admin = { userId: string; displayName: string | null; isOwner: boolean };
export type Group = {
  groupId: string;
  name: string;
  description: string | null;
  isOwner: boolean;
  memberCount: number;
  admins: Admin[];
};

/** 보고 있는 모임을 바꾼다. 세 곳(전체공개 칸·각 카드·상단 전환기)이 같은 일을 한다. */
function useSwitchGroup() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function switchTo(groupId: string | null) {
    setBusy(true);
    setError(null);
    const result = await apiPut("/api/admin/groups/active", { groupId });
    setBusy(false);
    if (result.ok) router.refresh();
    else setError(result.message);
  }

  return { switchTo, busy, error };
}

export function GroupSettings({
  groups,
  activeGroupId,
}: {
  groups: Group[];
  activeGroupId: string | null;
}) {
  const [dialog, setDialog] = useState<"create" | "join" | null>(null);
  const { switchTo, busy, error } = useSwitchGroup();

  return (
    <div className="grid max-w-3xl gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-[var(--surface-text-muted)]">
          {groups.length > 0 ? `속한 모임 ${groups.length}개` : "전체공개만 쓰는 중"}
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setDialog("create")}>
            모임 만들기
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setDialog("join")}>
            초대 코드로 참여
          </Button>
        </div>
      </div>

      <FormError>{error}</FormError>

      <ChannelCard
        title="전체공개"
        meta="모든 주선자가 보는 방"
        description="모임에 넣지 않은 프로필이 여기 모입니다. 설정할 것이 없습니다."
        active={activeGroupId == null}
        busy={busy}
        onSwitch={() => void switchTo(null)}
      />

      {groups.map((group) => (
        <GroupCard
          key={group.groupId}
          group={group}
          active={group.groupId === activeGroupId}
          switchBusy={busy}
          onSwitch={() => void switchTo(group.groupId)}
        />
      ))}

      <CreateDialog open={dialog === "create"} onClose={() => setDialog(null)} />
      <JoinDialog open={dialog === "join"} onClose={() => setDialog(null)} />
    </div>
  );
}

/** 방 한 칸의 공통 머리 — 이름, 한 줄 설명, 「보는 중」/「이 모임 보기」. */
function ChannelCard({
  title,
  meta,
  description,
  active,
  busy,
  onSwitch,
  children,
}: {
  title: string;
  meta: string;
  description?: string | null;
  active: boolean;
  busy: boolean;
  onSwitch: () => void;
  children?: ReactNode;
}) {
  return (
    <Panel
      className={cn(active && "border-[var(--color-rose-300)]")}
      title={title}
      action={
        active ? (
          <span className="shrink-0 rounded-[var(--radius-pill)] bg-[var(--color-rose-100)] px-2.5 py-1 text-[11.5px] text-[var(--color-rose-600)]">
            보는 중
          </span>
        ) : (
          <Button size="sm" variant="secondary" disabled={busy} onClick={onSwitch}>
            이 모임 보기
          </Button>
        )
      }
      tight
    >
      <p className="text-[12.5px] text-[var(--surface-text-muted)]">{meta}</p>
      {description ? (
        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--surface-text)]">
          {description}
        </p>
      ) : null}
      {children}
    </Panel>
  );
}

/** 모임 하나 — 접으면 요약, 펼치면 정보 수정 · 동료 초대 · 나가기. */
function GroupCard({
  group,
  active,
  switchBusy,
  onSwitch,
}: {
  group: Group;
  active: boolean;
  switchBusy: boolean;
  onSwitch: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `group-settings-${group.groupId}`;

  return (
    <ChannelCard
      title={group.name}
      meta={`회원 ${group.memberCount}명 · 주선자 ${group.admins.length}명`}
      description={group.description}
      active={active}
      busy={switchBusy}
      onSwitch={onSwitch}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="mt-2.5 inline-flex items-center gap-1 text-[12.5px] text-[var(--color-rose-600)] transition-colors hover:underline"
      >
        {open ? "설정 닫기" : "설정"}
        <span aria-hidden className="text-[10px]">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open ? (
        <div id={panelId} className="mt-4 grid gap-5 border-t border-[var(--surface-border)] pt-4">
          <GroupProfileForm group={group} />
          <GroupAdmins group={group} />
          <LeaveGroup group={group} />
        </div>
      ) : null}
    </ChannelCard>
  );
}

/** 이름·설명 수정. 설명은 주선자끼리만 보는 메모다. */
function GroupProfileForm({ group }: { group: Group }) {
  const router = useRouter();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = name !== group.name || description !== (group.description ?? "");

  return (
    <section>
      <Field label="모임 이름">
        <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
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
    </section>
  );
}

/** 동료 주선자 목록과 초대 코드 발급. 코드는 발급 직후 한 번만 보인다. */
function GroupAdmins({ group }: { group: Group }) {
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section>
      <h3 className="mb-2 text-[13px] font-medium text-[var(--surface-text)]">주선자</h3>
      <ul className="mb-3 flex flex-wrap gap-1.5">
        {group.admins.map((admin) => (
          <li
            key={admin.userId}
            className="rounded-[var(--radius-pill)] border border-[var(--surface-border)] px-2.5 py-1 text-[12.5px]"
          >
            {admin.displayName ?? "이름 없음"}
            {admin.isOwner ? (
              <span className="ml-1.5 text-[11.5px] text-[var(--surface-text-muted)]">개설자</span>
            ) : null}
          </li>
        ))}
      </ul>

      {issued ? (
        <div className="space-y-2">
          <p className="text-[12.5px]">동료에게 이 코드를 전달하세요. 다시 볼 수 없습니다.</p>
          <CopyField value={issued.code} />
          <p className="text-[11.5px] text-[var(--surface-text-muted)]">
            {new Date(issued.expiresAt).toLocaleString("ko-KR")} 까지 · 1회용
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
    </section>
  );
}

/** 모임 나가기. 마지막 주선자는 회원이 남아 있는 동안 나갈 수 없다(서버가 막는다). */
function LeaveGroup({ group }: { group: Group }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section>
      <p className="mb-2.5 text-[12px] leading-relaxed text-[var(--surface-text-muted)]">
        나가면 이 모임의 회원이 보이지 않습니다. 다시 들어오려면 초대 코드가 필요합니다.
        마지막 주선자라면 회원이 남아 있는 동안 나갈 수 없습니다.
      </p>
      <ConfirmButton
        variant="danger"
        label={busy ? "나가는 중…" : "모임 나가기"}
        confirmLabel="나가기"
        message={`「${group.name}」 의 회원이 더 이상 보이지 않습니다. 다시 들어오려면 초대 코드가 필요합니다.`}
        disabled={busy}
        onConfirm={() =>
          void (async () => {
            setBusy(true);
            setError(null);
            const result = await apiDelete(`/api/admin/groups/${group.groupId}`);
            setBusy(false);
            if (result.ok) router.refresh();
            else setError(result.message);
          })()
        }
      />
      <FormError>{error}</FormError>
    </section>
  );
}

/** 만들기·참여 공용 창. 둘 다 입력 한두 개짜리라 화면을 차지하고 있을 이유가 없다. */
function FormDialog({
  open,
  onClose,
  title,
  description,
  submitLabel,
  busyLabel,
  busy,
  disabled,
  error,
  onSubmit,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  submitLabel: string;
  busyLabel: string;
  busy: boolean;
  disabled: boolean;
  error: string | null;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} label={title}>
      <h2 className="display text-[19px] text-[var(--surface-text)]">{title}</h2>
      <p className="mb-4 mt-1.5 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
        {description}
      </p>
      <div className="grid gap-3">{children}</div>
      <FormError>{error}</FormError>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          취소
        </Button>
        <Button disabled={busy || disabled} onClick={onSubmit}>
          {busy ? busyLabel : submitLabel}
        </Button>
      </div>
    </Dialog>
  );
}

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="모임 만들기"
      description="모임에 등록한 회원은 같은 모임 주선자만 봅니다. 만들면 바로 그 모임을 보게 됩니다."
      submitLabel="모임 만들기"
      busyLabel="만드는 중…"
      busy={busy}
      disabled={name.trim().length === 0}
      error={error}
      onSubmit={() =>
        void (async () => {
          setBusy(true);
          setError(null);
          const result = await apiPost("/api/admin/groups", {
            name,
            description: description || undefined,
          });
          setBusy(false);
          if (!result.ok) {
            setError(result.message);
            return;
          }
          setName("");
          setDescription("");
          onClose();
          router.refresh();
        })()
      }
    >
      <Field label="모임 이름">
        <Input
          placeholder="예) 볼사람 강남"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="설명" hint="선택. 주선자끼리만 봅니다">
        <Textarea
          placeholder="어떤 분들을 주로 다루는 모임인지 적어두세요."
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-20 text-[12.5px]"
        />
      </Field>
    </FormDialog>
  );
}

function JoinDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="초대 코드로 참여"
      description="동료 주선자에게 받은 코드를 넣으면 그 모임에 합류합니다. 이미 속한 모임이 있어도 됩니다."
      submitLabel="모임 참여"
      busyLabel="참여 중…"
      busy={busy}
      disabled={code.length < 8}
      error={error}
      onSubmit={() =>
        void (async () => {
          setBusy(true);
          setError(null);
          const result = await apiPost("/api/admin/groups/join", { code });
          setBusy(false);
          if (!result.ok) {
            setError(result.message);
            return;
          }
          setCode("");
          onClose();
          router.refresh();
        })()
      }
    >
      <Field label="초대 코드">
        <Input
          placeholder="받은 코드"
          value={code}
          onChange={(e) => setCode(e.target.value.trim())}
        />
      </Field>
    </FormDialog>
  );
}
