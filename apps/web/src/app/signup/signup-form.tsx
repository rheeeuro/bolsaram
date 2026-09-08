"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SIGNUP_PASSWORD_MIN } from "@bolsaram/schemas";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { apiPost } from "@/lib/api-client";

/**
 * 주선자 가입.
 *
 * 가입하면 **모임 없이** 시작한다. 전체공개 프로필을 둘러볼 수 있고, 모임은 그 뒤에
 * 만들거나 초대 코드로 참여한다 — 화면에서 그 순서를 분명히 말해준다.
 */
export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready =
    email.includes("@") &&
    password.length >= SIGNUP_PASSWORD_MIN &&
    displayName.trim().length > 0;

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await apiPost("/api/auth/signup", { email, password, displayName });
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
      <Field label="이름">
        <Input
          placeholder="주선자 이름"
          value={displayName}
          maxLength={60}
          autoComplete="name"
          autoFocus
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
        <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
      </Field>

      <FormError>{error}</FormError>

      <Button type="submit" size="lg" className="w-full" disabled={!ready || busy}>
        {busy ? "가입 중…" : "가입하기"}
      </Button>

      {/* 버튼이 잠긴 이유를 화면에서 말해준다 — 비활성 버튼만 보여주지 않는다. */}
      {!ready ? (
        <p className="text-[12px] leading-relaxed text-[var(--color-ink-600)]">
          이름, 이메일, {SIGNUP_PASSWORD_MIN}자 이상의 비밀번호를 모두 채우면 가입할 수
          있습니다.
        </p>
      ) : null}

      <p className="text-[12px] leading-relaxed text-[var(--color-ink-600)]">
        가입하면 전체공개 프로필을 둘러볼 수 있습니다. 모임은 그 뒤에 만들거나 초대
        코드로 참여하세요 — 모임에 등록한 회원은 그 모임 주선자만 봅니다.
      </p>
    </form>
  );
}
