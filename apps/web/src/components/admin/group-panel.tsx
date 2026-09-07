"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/admin/table";
import { Field, Input } from "@/components/ui/field";
import { apiPost, apiPut } from "@/lib/api-client";

type Admin = { userId: string; displayName: string | null; isOwner: boolean };

/**
 * 모임 관리.
 *
 * 모임이 없으면 만들기·참여를 보여주고, 있으면 구성원과 초대 코드 발급을 보여준다.
 * 모임이 없는 상태도 정상이다 — 그때는 전체공개 프로필만 다룬다.
 */
export function GroupPanel({
  group,
}: {
  group: { groupId: string; name: string; admins: Admin[] } | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(what: string, fn: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(what);
    setError(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) {
      setError(result.message ?? "요청을 처리하지 못했습니다.");
      return false;
    }
    return true;
  }

  if (group) {
    return (
      <Card title={`모임 · ${group.name}`}>
        <ul className="mb-3 space-y-1 text-[12.5px]">
          {group.admins.map((a) => (
            <li key={a.userId}>
              {a.displayName ?? "이름 없음"}
              {a.isOwner ? (
                <span className="ml-1.5 text-[11.5px] text-[var(--surface-text-muted)]">
                  개설자
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        {issued ? (
          <div className="space-y-2">
            <p className="text-[12.5px]">
              동료 주선자에게 이 코드를 전달하세요. 다시 볼 수 없습니다.
            </p>
            <code className="block overflow-x-auto rounded-md border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2 text-[12.5px]">
              {issued.code}
            </code>
            <p className="text-[11.5px] text-[var(--surface-text-muted)]">
              {new Date(issued.expiresAt).toLocaleString("ko-KR")} 까지 유효 · 1회용
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
                const r = await apiPost<{ code: string; expiresAt: string }>(
                  "/api/admin/group",
                );
                setBusy(null);
                if (r.ok) setIssued(r.data);
                else setError(r.message);
              })()
            }
          >
            {busy === "invite" ? "발급 중…" : "주선자 초대 코드 받기"}
          </Button>
        )}

        {error ? (
          <p className="mt-3 text-[12.5px] text-[var(--color-danger)]">{error}</p>
        ) : null}
      </Card>
    );
  }

  return (
    <Card title="모임">
      <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
        지금은 모임 없이 <strong>전체공개 프로필</strong>만 다룹니다. 모임을 만들면 그
        모임에 등록한 회원은 같은 모임 주선자만 보게 됩니다.
      </p>

      <Field label="새 모임 만들기">
        <Input
          placeholder="모임 이름 (예: 볼사람 강남)"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Button
        className="mt-2"
        disabled={busy != null || name.trim().length === 0}
        onClick={() =>
          void (async () => {
            if (await run("create", () => apiPost("/api/admin/groups", { name })))
              router.refresh();
          })()
        }
      >
        {busy === "create" ? "만드는 중…" : "모임 만들기"}
      </Button>

      <div className="mt-5 border-t border-[var(--surface-border)] pt-4">
        <Field label="초대 코드로 참여">
          <Input
            placeholder="받은 초대 코드"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.trim())}
          />
        </Field>
        <Button
          variant="secondary"
          className="mt-2"
          disabled={busy != null || joinCode.length < 8}
          onClick={() =>
            void (async () => {
              if (await run("join", () => apiPut("/api/admin/group", { code: joinCode })))
                router.refresh();
            })()
          }
        >
          {busy === "join" ? "참여 중…" : "모임 참여"}
        </Button>
      </div>

      {error ? <p className="mt-3 text-[12.5px] text-[var(--color-danger)]">{error}</p> : null}
    </Card>
  );
}
