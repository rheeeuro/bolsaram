"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";

type Mode = "member" | "admin";

export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("member");

  return (
    <div>
      <div className="mb-6 flex gap-1 rounded-xl bg-[var(--color-ivory-200)] p-1">
        {(["member", "admin"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={cn(
              "flex-1 rounded-lg py-2 text-[13px] font-medium transition-colors",
              mode === value
                ? "bg-white text-[var(--color-ink-900)] shadow-sm"
                : "text-[var(--color-ink-600)]",
            )}
          >
            {value === "member" ? "회원" : "주선자"}
          </button>
        ))}
      </div>

      {mode === "member" ? (
        <MemberLogin onDone={() => router.replace(next ?? "/discover")} />
      ) : (
        <AdminLogin onDone={() => router.replace(next ?? "/admin")} />
      )}
    </div>
  );
}

function MemberLogin({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  /** 문자가 실제로 도착하는 경로였는지. false 면 기다려도 오지 않는다. */
  const [delivered, setDelivered] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function request() {
    setBusy(true);
    setError(null);
    const result = await apiPost<{ devCode?: string; delivered?: boolean }>(
      "/api/auth/otp/request",
      { phone },
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSent(true);
    setDevCode(result.data.devCode ?? null);
    setDelivered(result.data.delivered !== false);
  }

  async function verify() {
    setBusy(true);
    setError(null);
    const result = await apiPost("/api/auth/otp/verify", { phone, code });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onDone();
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void (sent ? verify() : request());
      }}
    >
      <Field label="휴대폰 번호">
        <Input
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          placeholder="010-0000-0000"
          value={phone}
          disabled={sent}
          onChange={(e) => setPhone(e.target.value)}
        />
      </Field>

      {sent && !delivered && !devCode ? (
        <p className="rounded-lg bg-[var(--color-ivory-200)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--color-ink-700)]">
          문자 발송이 아직 연동되지 않았습니다. 인증번호를 받으려면 주선자에게 문의해
          주세요.
        </p>
      ) : null}

      {sent ? (
        <Field label="인증번호" hint="5분 안에 입력해 주세요">
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6자리"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
          />
        </Field>
      ) : null}

      {devCode ? (
        <p className="rounded-lg bg-[var(--color-ivory-200)] px-3 py-2 text-[12px] text-[var(--color-ink-700)]">
          개발 환경 인증번호: <strong className="font-mono">{devCode}</strong>
        </p>
      ) : null}

      {error ? <p className="text-[13px] text-[var(--color-danger)]">{error}</p> : null}

      <Button type="submit" size="lg" disabled={busy || phone.length < 10}>
        {busy ? "처리 중…" : sent ? "로그인" : "인증번호 받기"}
      </Button>

      {sent ? (
        <button
          type="button"
          className="text-[12px] text-[var(--color-ink-600)] underline"
          onClick={() => {
            setSent(false);
            setCode("");
            setDevCode(null);
          }}
        >
          번호 다시 입력
        </button>
      ) : null}
    </form>
  );
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
