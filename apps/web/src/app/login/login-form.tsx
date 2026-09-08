"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { apiPost } from "@/lib/api-client";

/**
 * 주선자 전용 로그인 폼.
 *
 * 회원은 여기를 지나지 않는다 — 초대 링크나 입장코드가 곧 로그인이다(`/enter`).
 * 실패 메시지는 서버가 계정 존재 여부를 구분하지 않고 내려주는 것을 그대로 쓴다.
 */
export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
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
          if (!result.ok) {
            setBusy(false);
            setError(result.message);
            return;
          }
          router.replace(next ?? "/admin");
        })();
      }}
    >
      <Field label="이메일">
        <Input
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="off"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="비밀번호">
        <PasswordInput
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
      </Field>
      <FormError>{error}</FormError>
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? "확인 중…" : "로그인"}
      </Button>
    </form>
  );
}
