"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/host/surface";
import { Field, Input, Textarea } from "@/components/ui/field";
import { CopyField } from "@/components/ui/copy-field";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { apiDelete, apiPatch, apiPost, apiPut } from "@/lib/api-client";
import { cn } from "@/lib/cn";

/**
 * 모임 관리.
 *
 * 한 주선자가 **여러 모임에 동시에 속한다.** 이 화면은 속한 모임을 전부 늘어놓고
 * 각각을 따로 다룬다 — 이름·설명 고치기, 동료 초대 코드 발급, 나가기. 위쪽에서는
 * 새 모임을 만들거나 받은 코드로 합류한다.
 *
 * 어느 모임에서 일할지는 상단 전환기가 정한다. 여기서 「이 모임 보기」를 누르면
 * 같은 일이 일어난다.
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

export function GroupSettings({
  groups,
  activeGroupId,
}: {
  groups: Group[];
  activeGroupId: string | null;
}) {
  return (
    <div className="grid gap-5">
      <JoinOrCreate hasGroups={groups.length > 0} />

      {groups.length > 0 ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {groups.map((group) => (
            <GroupCard key={group.groupId} group={group} active={group.groupId === activeGroupId} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 새 모임 만들기 · 초대 코드로 합류. 모임이 몇 개 있든 늘 열려 있다. */
function JoinOrCreate({ hasGroups }: { hasGroups: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(what: string, run: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(what);
    setError(null);
    const result = await run();
    setBusy(null);
    if (result.ok) {
      setName("");
      setDescription("");
      setCode("");
      router.refresh();
    } else {
      setError(result.message ?? "요청을 처리하지 못했습니다.");
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="모임 만들기">
        <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
          모임에 등록한 회원은 같은 모임 주선자만 봅니다.
          {hasGroups
            ? " 새로 만들면 바로 그 모임으로 옮겨 갑니다."
            : " 모임 없이도 전체공개 프로필은 다룰 수 있습니다."}
        </p>
        <Field label="모임 이름">
          <Input
            placeholder="예) 볼사람 강남"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="mt-3">
          <Field label="설명" hint="선택. 주선자끼리만 봅니다">
            <Textarea
              placeholder="어떤 분들을 주로 다루는 모임인지 적어두세요."
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-20 text-[12.5px]"
            />
          </Field>
        </div>
        <Button
          className="mt-3"
          disabled={busy != null || name.trim().length === 0}
          onClick={() =>
            void act("create", () =>
              apiPost("/api/admin/groups", { name, description: description || undefined }),
            )
          }
        >
          {busy === "create" ? "만드는 중…" : "모임 만들기"}
        </Button>
      </Panel>

      <Panel title="초대 코드로 참여">
        <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
          동료 주선자에게 받은 코드를 넣으면 그 모임에 합류합니다. 이미 속한 모임이 있어도
          됩니다 — 모임은 몇 개든 함께 다룰 수 있습니다.
        </p>
        <Field label="초대 코드">
          <Input
            placeholder="받은 코드"
            value={code}
            onChange={(e) => setCode(e.target.value.trim())}
          />
        </Field>
        <Button
          variant="secondary"
          className="mt-3"
          disabled={busy != null || code.length < 8}
          onClick={() => void act("join", () => apiPost("/api/admin/groups/join", { code }))}
        >
          {busy === "join" ? "참여 중…" : "모임 참여"}
        </Button>
      </Panel>

      {error ? (
        <p className="text-[12.5px] text-[var(--color-danger)] lg:col-span-2">{error}</p>
      ) : null}
    </div>
  );
}

/** 모임 하나 — 정보 수정 · 구성원 · 초대 코드 · 나가기. */
function GroupCard({ group, active }: { group: Group; active: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = name !== group.name || description !== (group.description ?? "");
  const base = `/api/admin/groups/${group.groupId}`;

  return (
    <Panel
      className={cn(active && "border-[var(--color-rose-300)]")}
      title={group.name}
      action={
        active ? (
          <span className="shrink-0 rounded-[var(--radius-pill)] bg-[var(--color-rose-100)] px-2.5 py-1 text-[11.5px] text-[var(--color-rose-600)]">
            보는 중
          </span>
        ) : (
          <button
            type="button"
            disabled={busy != null}
            className="text-[12px] text-[var(--color-rose-600)] transition-colors hover:underline"
            onClick={() =>
              void (async () => {
                setBusy("switch");
                const result = await apiPut("/api/admin/groups/active", {
                  groupId: group.groupId,
                });
                setBusy(null);
                if (result.ok) router.refresh();
                else setError(result.message);
              })()
            }
          >
            이 모임 보기
          </button>
        )
      }
    >
      <p className="mb-3 text-[12px] text-[var(--surface-text-muted)]">
        회원 {group.memberCount}명 · 주선자 {group.admins.length}명
      </p>

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
      <Button
        className="mt-3"
        disabled={busy != null || !dirty || name.trim().length === 0}
        onClick={() =>
          void (async () => {
            setBusy("save");
            setError(null);
            setMessage(null);
            const result = await apiPatch(base, { name, description });
            setBusy(null);
            if (result.ok) {
              setMessage("저장했습니다.");
              router.refresh();
            } else {
              setError(result.message);
            }
          })()
        }
      >
        {busy === "save" ? "저장 중…" : "저장"}
      </Button>
      {message ? (
        <p className="mt-2 text-[12.5px] text-[var(--surface-text-muted)]">{message}</p>
      ) : null}

      <div className="mt-5 border-t border-[var(--surface-border)] pt-4">
        <ul className="mb-3 space-y-1.5 text-[12.5px]">
          {group.admins.map((a) => (
            <li key={a.userId} className="flex items-center gap-2">
              <span>{a.displayName ?? "이름 없음"}</span>
              {a.isOwner ? (
                <span className="text-[11.5px] text-[var(--surface-text-muted)]">개설자</span>
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
            variant="secondary"
            disabled={busy != null}
            onClick={() =>
              void (async () => {
                setBusy("invite");
                setError(null);
                const result = await apiPost<{ code: string; expiresAt: string }>(
                  `${base}/invite`,
                );
                setBusy(null);
                if (result.ok) setIssued(result.data);
                else setError(result.message);
              })()
            }
          >
            {busy === "invite" ? "발급 중…" : "주선자 초대 코드 받기"}
          </Button>
        )}
      </div>

      <div className="mt-5 border-t border-[var(--surface-border)] pt-4">
        <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
          나가면 이 모임의 회원이 보이지 않습니다. 다시 들어오려면 초대 코드가 필요합니다.
          <br />
          마지막 주선자라면 <strong>회원이 남아 있는 동안 나갈 수 없습니다</strong> —
          전체공개로 옮기거나 동료를 먼저 초대해 주세요.
        </p>
        <ConfirmButton
          size="md"
          variant="danger"
          label={busy === "leave" ? "나가는 중…" : "모임 나가기"}
          confirmLabel="나가기"
          message={`「${group.name}」 의 회원이 더 이상 보이지 않습니다. 다시 들어오려면 초대 코드가 필요합니다.`}
          disabled={busy != null}
          onConfirm={() =>
            void (async () => {
              setBusy("leave");
              setError(null);
              const result = await apiDelete(base);
              setBusy(null);
              if (result.ok) router.refresh();
              else setError(result.message);
            })()
          }
        />
      </div>

      {error ? <p className="mt-3 text-[12.5px] text-[var(--color-danger)]">{error}</p> : null}
    </Panel>
  );
}
