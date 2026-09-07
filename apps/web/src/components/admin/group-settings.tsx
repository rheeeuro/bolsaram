"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/admin/table";
import { Field, Input, Textarea } from "@/components/ui/field";
import { apiDelete, apiPatch, apiPost, apiPut } from "@/lib/api-client";

type Admin = { userId: string; displayName: string | null; isOwner: boolean };
export type Group = {
  groupId: string;
  name: string;
  description: string | null;
  isOwner: boolean;
  admins: Admin[];
};

/** 모임이 없는 주선자 — 만들기 / 초대 코드로 참여. */
function NoGroup() {
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
    if (result.ok) router.refresh();
    else setError(result.message ?? "요청을 처리하지 못했습니다.");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="모임 만들기">
        <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
          모임에 등록한 회원은 같은 모임 주선자만 봅니다. 모임 없이도 전체공개 프로필은
          다룰 수 있습니다.
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
      </Card>

      <Card title="초대 코드로 참여">
        <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
          동료 주선자에게 받은 코드를 넣으면 그 모임에 합류합니다. 한 사람은 한 모임에만
          속합니다.
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
          onClick={() => void act("join", () => apiPut("/api/admin/group", { code }))}
        >
          {busy === "join" ? "참여 중…" : "모임 참여"}
        </Button>
      </Card>

      {error ? (
        <p className="text-[12.5px] text-[var(--color-danger)] lg:col-span-2">{error}</p>
      ) : null}
    </div>
  );
}

/** 모임이 있는 주선자 — 정보 수정 · 구성원 · 초대 코드 발급. */
function HasGroup({ group }: { group: Group }) {
  const router = useRouter();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = name !== group.name || description !== (group.description ?? "");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="모임 정보">
        <Field label="모임 이름">
          <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="mt-3">
          <Field label="설명" hint="주선자끼리만 봅니다">
            <Textarea
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-24 text-[12.5px]"
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
              const result = await apiPatch("/api/admin/group", { name, description });
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
      </Card>

      <Card title={`주선자 ${group.admins.length}명`}>
        <ul className="mb-4 space-y-1.5 text-[12.5px]">
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
            <p className="text-[12.5px]">
              동료에게 이 코드를 전달하세요. 다시 볼 수 없습니다.
            </p>
            <code className="block overflow-x-auto rounded-md border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2 text-[12.5px]">
              {issued.code}
            </code>
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
                  "/api/admin/group",
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
      </Card>

      <Card title="모임 나가기">
        <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
          나가면 이 모임의 회원이 보이지 않습니다. 다시 들어오려면 초대 코드가 필요합니다.
          <br />
          마지막 주선자라면 <strong>회원이 남아 있는 동안 나갈 수 없습니다</strong> —
          전체공개로 옮기거나 동료를 먼저 초대해 주세요.
        </p>
        <Button
          variant="danger"
          disabled={busy != null}
          onClick={() =>
            void (async () => {
              setBusy("leave");
              setError(null);
              const result = await apiDelete("/api/admin/group");
              setBusy(null);
              if (result.ok) router.refresh();
              else setError(result.message);
            })()
          }
        >
          {busy === "leave" ? "나가는 중…" : "모임 나가기"}
        </Button>
      </Card>

      {error ? (
        <p className="text-[12.5px] text-[var(--color-danger)] lg:col-span-2">{error}</p>
      ) : null}
    </div>
  );
}

export function GroupSettings({ group }: { group: Group | null }) {
  return group ? <HasGroup group={group} /> : <NoGroup />;
}
