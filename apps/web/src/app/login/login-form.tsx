"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { apiPost } from "@/lib/api-client";

/**
 * 이 화면에는 두 가지 진입이 함께 있다.
 *
 *   회원   — 아이디·비밀번호가 없다. 초대 링크가 곧 로그인이고, 링크 없이 코드만
 *            받은 경우를 위해 같은 값을 입장코드로 넣을 수 있게 한다.
 *   주선자 — 이메일·비밀번호. 계정을 가진 쪽은 주선자뿐이다.
 *
 * SMS 를 쓰지 않으므로 회원용 인증번호 경로는 없다.
 */
export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-8">
      <MemberEntry />
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--surface-border)]" />
        <span className="text-[12px] text-[var(--color-ink-500)]">주선자</span>
        <span className="h-px flex-1 bg-[var(--surface-border)]" />
      </div>
      <AdminLogin onDone={() => router.replace(next ?? "/admin")} />
    </div>
  );
}

/**
 * 입장코드로 들어가기.
 *
 * 코드는 초대 링크의 토큰과 같은 값이다 — 따로 검증하지 않고 claim 화면으로 넘긴다.
 * 유효성(만료·재사용) 판정은 서버 한 곳(`previewInvite`)에만 둔다.
 * 링크 전체를 붙여넣는 사람이 많으므로 링크에서도 코드를 뽑아낸다.
 */
function MemberEntry() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const token = extractInviteCode(code);
        if (!token) {
          setError("입장코드를 넣어 주세요.");
          return;
        }
        setError(null);
        router.push(`/claim/${encodeURIComponent(token)}`);
      }}
    >
      <div>
        <h2 className="text-[15px] font-medium text-[var(--color-ink-900)]">
          회원으로 들어가기
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--color-ink-600)]">
          회원은 아이디·비밀번호가 없습니다. 주선자가 보낸 초대 링크를 열면 바로
          들어갑니다. 코드만 받으셨다면 아래에 넣어 주세요.
        </p>
      </div>
      <Field label="입장코드" error={error}>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="주선자에게 받은 코드 또는 링크"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Button type="submit" variant="secondary" size="lg">
        들어가기
      </Button>
    </form>
  );
}

/** 코드만 붙여넣었으면 그대로, 링크를 붙여넣었으면 마지막 조각을 쓴다. */
function extractInviteCode(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const marker = "/claim/";
  const at = value.lastIndexOf(marker);
  const token = at >= 0 ? value.slice(at + marker.length) : value;
  const cleaned = token.split(/[?#/\s]/)[0] ?? "";
  if (!cleaned) return null;
  // 링크에서 뽑은 값은 인코딩돼 있을 수 있다. 실패하면 원문을 그대로 쓴다.
  try {
    return decodeURIComponent(cleaned);
  } catch {
    return cleaned;
  }
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
      <div>
        <h2 className="text-[15px] font-medium text-[var(--color-ink-900)]">주선자 로그인</h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--color-ink-600)]">
          이메일과 비밀번호를 쓰는 것은 주선자뿐입니다.
        </p>
      </div>
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
