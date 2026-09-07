"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { apiPost } from "@/lib/api-client";

/**
 * 로그인은 주선자 전용이다.
 *
 * 회원은 비밀번호가 없다 — 주선자가 카카오톡으로 보낸 초대 링크가 곧 로그인이다.
 * SMS 를 쓰지 않으므로 회원용 인증번호 경로는 없다.
 */
export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  return <AdminLogin onDone={() => router.replace(next ?? "/admin")} />;
}

function AdminLogin({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void (async () => {
          setBusy(true);
          setError(null);
          const result = await apiPost("/api/auth/admin-login", { email, password });
          setBusy(false);
          if (!result.ok) {
            setError(result.message);
            return;
          }
          onDone();
        })();
      }}
    >
      <Field label="이메일">
        <Input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="비밀번호">
        <Input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {error ? <p className="text-[13px] text-[var(--color-danger)]">{error}</p> : null}
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? "확인 중…" : "로그인"}
      </Button>
    </form>
  );
}
