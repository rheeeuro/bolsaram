"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { extractInviteCode } from "@/lib/invite-code";

/**
 * 입장코드 입력.
 *
 * 여기서는 형식만 본다 — 만료·재사용 판정은 `/claim` 이 서버에서 한 번만 한다.
 * 코드가 43자라 손으로 옮겨 적는 사람은 거의 없다. 붙여넣기를 1순위 동작으로 둔다.
 */
export function EnterForm({ initialCode, next }: { initialCode: string; next: string | null }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 클립보드 읽기는 브라우저·권한에 따라 없을 수 있다. 있을 때만 버튼을 보인다.
  const [canPaste, setCanPaste] = useState(false);

  useEffect(() => {
    setCanPaste(typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function");
  }, []);

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setError("복사된 내용이 없습니다.");
        return;
      }
      setCode(text.trim());
      setError(null);
    } catch {
      setError("붙여넣기 권한이 없습니다. 코드를 직접 넣어 주세요.");
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const token = extractInviteCode(code);
        if (!token) {
          setError("입장코드를 넣어 주세요.");
          return;
        }
        setError(null);
        // 이동하는 동안 버튼을 잠근다 — 이 컴포넌트는 곧 사라진다.
        setBusy(true);
        const query = next ? `?next=${encodeURIComponent(next)}` : "";
        router.push(`/claim/${encodeURIComponent(token)}${query}`);
      }}
    >
      <Field label="입장코드" hint="링크 전체를 붙여넣어도 됩니다" error={error}>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="주선자에게 받은 코드"
          className="font-mono text-[13px] tracking-tight"
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </Field>

      <div className="flex gap-2">
        <Button type="submit" size="lg" className="flex-1" disabled={busy}>
          {busy ? "들어가는 중…" : "들어가기"}
        </Button>
        {canPaste ? (
          <Button type="button" variant="secondary" size="lg" onClick={() => void paste()}>
            붙여넣기
          </Button>
        ) : null}
      </div>
    </form>
  );
}
