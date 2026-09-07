"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SIGNUP_PASSWORD_MIN } from "@bolsaram/schemas";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { apiPost } from "@/lib/api-client";

/**
 * 주선자 가입.
 *
 * 가입하면 **자기 모임이 하나 생기고, 그 모임만 볼 수 있다.** 다른 주선자가 등록한
 * 회원은 보이지 않는다 — 화면에서 그 사실을 분명히 말해준다.
 */
export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready =
    email.includes("@") &&
    password.length >= SIGNUP_PASSWORD_MIN &&
    displayName.trim().length > 0 &&
    groupName.trim().length > 0;

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await apiPost("/api/auth/signup", {
      email,
      password,
      displayName,
      groupName,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.replace("/admin");
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) void submit();
      }}
    >
      <Field label="모임 이름" hint="회원에게는 보이지 않습니다. 나중에 바꿀 수 있습니다">
        <Input
          placeholder="예) 볼사람 강남"
          value={groupName}
          maxLength={80}
          onChange={(e) => setGroupName(e.target.value)}
        />
      </Field>

      <Field label="이름">
        <Input
          placeholder="주선자 이름"
          value={displayName}
          maxLength={60}
          autoComplete="name"
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </Field>

      <Field label="이메일">
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <Field label="비밀번호" hint={`${SIGNUP_PASSWORD_MIN}자 이상`}>
        <Input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      {error ? <p className="text-[13px] text-[var(--color-danger)]">{error}</p> : null}

      <Button type="submit" size="lg" className="w-full" disabled={!ready || busy}>
        {busy ? "만드는 중…" : "모임 만들고 시작하기"}
      </Button>

      <p className="text-[12px] leading-relaxed text-[var(--color-ink-600)]">
        가입하면 회원님만의 모임이 생깁니다. 다른 주선자가 등록한 회원은 보이지 않고,
        회원끼리도 같은 모임 안에서만 서로를 봅니다.
      </p>
    </form>
  );
}
