"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  OAUTH_PROVIDER_LABELS,
  displayNameSchema,
  type OAuthProvider,
} from "@bolsaram/schemas";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/host/surface";
import { Field, FormError, Input } from "@/components/ui/field";
import { ProviderMark } from "@/components/ui/provider-mark";
import { apiPatch, apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";

/**
 * 계정 설정의 칸들 — 내 이름 · 로그인 방식 · 로그인 상태.
 *
 * 계정에 관한 것은 창(모달)이 아니라 **화면 하나**에 모은다. 모임과 무관하게 한 번
 * 정해 두고 오래 쓰는 설정이라, 모임 화면 사이에 흩어 두면 어디서 고치는지가
 * 기억에 남지 않는다. 같은 화면의 텔레그램 연결도 그래서 여기 있다.
 *
 * 순서는 손이 자주 가는 것부터다. 이름은 언제든 바꾸고, 로그인 방식은 확인만 하고,
 * 로그아웃은 맨 뒤에 둔다.
 */

export type LoginMethod = {
  provider: OAuthProvider;
  email: string | null;
  /** ISO 문자열로 받는다 — 날짜 표기는 보는 사람의 시간대로 그린다. */
  linkedAt: string;
  lastLoginAt: string | null;
};

/** 표시 이름 수정. 저장하면 사이드바·모임 채팅의 이름이 함께 바뀐다. */
export function AccountNamePanel({ displayName }: { displayName: string | null }) {
  const router = useRouter();
  const current = displayName ?? "";
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 스키마가 최종 판정을 하고, 여기서는 버튼을 잠글지만 본다.
  const dirty = value.trim() !== current.trim();
  const ready = displayNameSchema.safeParse(value).success && dirty;

  return (
    <Panel title="내 이름">
      <div className="mb-4 flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--color-rose-100)] text-[17px] font-semibold text-[var(--color-burgundy-800)]"
        >
          {Array.from(displayName ?? "주선자")[0]}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-[var(--surface-text)]">
            {displayName ?? "주선자"} 님
          </p>
          <p className="text-[12px] text-[var(--surface-text-muted)]">주선자</p>
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready || busy) return;
          void (async () => {
            setBusy(true);
            setError(null);
            setSaved(false);
            const result = await apiPatch("/api/admin/me", { displayName: value.trim() });
            setBusy(false);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            setSaved(true);
            // 이름은 서버 컴포넌트가 세션에서 읽어 그린다. 새로 받아야 바뀐 값이 보인다.
            router.refresh();
          })();
        }}
      >
        <Field label="이름" hint="40자까지">
          <Input
            value={value}
            maxLength={40}
            autoComplete="name"
            onChange={(event) => {
              setValue(event.target.value);
              setSaved(false);
            }}
          />
        </Field>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={!ready || busy}>
            {busy ? "저장 중…" : "저장"}
          </Button>
          {dirty ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setValue(current);
                setError(null);
              }}
            >
              되돌리기
            </Button>
          ) : null}
          {saved && !dirty ? (
            <span role="status" className="text-[12.5px] text-[var(--surface-text-muted)]">
              저장했습니다.
            </span>
          ) : null}
        </div>
        <FormError>{error}</FormError>
      </form>

      <p className="mt-4 border-t border-[var(--surface-border)] pt-3 text-[12px] leading-relaxed text-[var(--surface-text-muted)]">
        동료 주선자에게 보이는 이름입니다 — 화면 왼쪽 위, 모임 설정의 주선자 목록, 모임
        채팅의 글쓴이에 쓰입니다. <b>멤버에게는 보이지 않습니다.</b>
      </p>
    </Panel>
  );
}

/**
 * 로그인 방식. 고칠 것이 없는 칸이지만 **확인할 것**이 있어 화면에 둔다 —
 * 어느 소셜 계정으로 들어와 있는지, 비밀번호가 없다는 사실, 2단계 인증 권고다.
 *
 * 연결을 여기서 추가하지 않는다. 이어붙이는 조건은 「같은 이메일」 하나뿐이고
 * (`loginWithOAuth`), 그 판정은 로그인할 때 일어난다.
 */
export function LoginMethodsPanel({
  methods,
  available,
}: {
  methods: LoginMethod[];
  /** 이 호스트에 키가 설정된 제공자. 없는 제공자는 안내하지 않는다. */
  available: OAuthProvider[];
}) {
  const linked = new Set(methods.map((method) => method.provider));
  const others = available.filter((provider) => !linked.has(provider));

  return (
    <Panel title="로그인 방식">
      {methods.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
          아직 연결된 소셜 계정이 없습니다.
        </p>
      ) : null}

      <ul className="divide-y divide-[var(--surface-border)]">
        {methods.map((method) => (
          <li key={method.provider} className="flex items-center gap-3 py-2.5 first:pt-0">
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-full",
                method.provider === "KAKAO"
                  ? "bg-[#FEE500] text-[#191600]"
                  : "border border-[var(--surface-border)] bg-white",
              )}
            >
              <ProviderMark provider={method.provider} size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] text-[var(--surface-text)]">
                {OAUTH_PROVIDER_LABELS[method.provider]}
              </p>
              <p className="truncate text-[12px] text-[var(--surface-text-muted)]">
                {method.email ?? "이메일 제공에 동의하지 않음"}
              </p>
            </div>
            {/* 날짜만 적으면 무슨 날짜인지 알 수 없다 — 무엇의 날짜인지 위에 붙인다. */}
            <span className="shrink-0 text-right text-[11px] leading-tight text-[var(--surface-text-muted)]">
              <span className="block">{method.lastLoginAt ? "마지막 로그인" : "연결"}</span>
              <span className="block">
                {formatDay(method.lastLoginAt ?? method.linkedAt)}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {others.length > 0 ? (
        <p
          className={cn(
            "rounded-[10px] bg-[var(--surface-muted)] px-3 py-2.5",
            "text-[12px] leading-relaxed text-[var(--surface-text-muted)]",
            methods.length > 0 ? "mt-3" : "mt-2.5",
          )}
        >
          {others.map((provider) => OAUTH_PROVIDER_LABELS[provider]).join(" · ")}로도 들어올
          수 있습니다. <b>이메일이 같으면 이 계정으로 이어집니다</b> — 다르면 별개의 주선자
          계정이 됩니다.
        </p>
      ) : null}

      <p className="mt-3 text-[12px] leading-relaxed text-[var(--surface-text-muted)]">
        비밀번호를 볼사람에 저장하지 않습니다. 계정을 지키는 것은 로그인에 쓰는 소셜 계정의
        보안 설정이니 <b>2단계 인증을 켜 두세요.</b>
      </p>
    </Panel>
  );
}

/** 로그아웃. 되돌리기 어려운 것이 아니라 확인 단계를 두지 않는다. */
export function SessionPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Panel title="로그인 상태">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
          이 브라우저의 로그인은 마지막 로그인으로부터 <b>30일</b> 뒤 만료됩니다.
        </p>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void apiPost("/api/auth/logout").then(() => {
              router.replace("/");
              router.refresh();
            });
          }}
        >
          {busy ? "로그아웃 중…" : "로그아웃"}
        </Button>
      </div>
    </Panel>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}
