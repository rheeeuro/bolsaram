"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/admin/table";
import { Field, Input } from "@/components/ui/field";
import { apiPost } from "@/lib/api-client";

/**
 * 모임에 속하지 않은 주선자에게 보여준다.
 *
 * 이 상태에서는 RLS 가 아무 데이터도 통과시키지 않으므로 화면이 전부 0 으로 보인다.
 * 빈 화면 대신 이유와 다음 행동을 알려준다.
 */
export function NoGroupPanel() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const result = await apiPost("/api/admin/groups", { name });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <Card title="아직 모임이 없습니다">
      <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
        모임에 속해야 회원을 등록하고 연결할 수 있습니다. 모임을 새로 만들거나, 함께
        일하는 주선자에게 초대를 받아 주세요.
      </p>
      <Field label="모임 이름">
        <Input
          placeholder="예) 볼사람 강남"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      {error ? <p className="mt-2 text-[12.5px] text-[var(--color-danger)]">{error}</p> : null}
      <Button
        className="mt-3"
        disabled={busy || name.trim().length === 0}
        onClick={() => void create()}
      >
        {busy ? "만드는 중…" : "모임 만들기"}
      </Button>
    </Card>
  );
}
