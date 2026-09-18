"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { displayNameSchema } from "@bolsaram/schemas";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/field";
import { apiPatch } from "@/lib/api-client";

/**
 * 상단의 「○○ 님」 — 누르면 표시 이름을 바꾼다.
 *
 * 이름은 카카오·구글이 준 값으로 시작하지만 그 뒤로는 본인이 정한다. 제공자 쪽에서
 * 닉네임을 바꿔도 여기는 따라가지 않으므로, 바꿀 길을 화면에 둬야 한다.
 *
 * 이름이 보이는 곳은 이 자리와 모임 설정의 주선자 목록, 모임 채팅의 작성자다.
 * 회원에게는 보이지 않는다.
 */
export function AccountName({ displayName }: { displayName: string | null }) {
  const [open, setOpen] = useState(false);
  const current = displayName ?? "주선자";

  return (
    <>
      <button
        type="button"
        title={`${current} 님 — 눌러서 이름 바꾸기`}
        onClick={() => setOpen(true)}
        className="min-w-0 truncate rounded-lg px-2 py-1 text-[12.5px] text-[var(--surface-text-muted)] transition-colors hover:bg-[var(--color-ivory-200)] hover:text-[var(--surface-text)]"
      >
        {current} 님
      </button>
      <NameDialog
        open={open}
        current={displayName ?? ""}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function NameDialog({
  open,
  current,
  onClose,
}: {
  open: boolean;
  current: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 스키마가 최종 판정을 하고, 여기서는 버튼을 잠글지만 본다.
  const ready = displayNameSchema.safeParse(value).success && value.trim() !== current;

  function close() {
    setValue(current);
    setError(null);
    onClose();
  }

  return (
    <Dialog open={open} onClose={close} label="이름 바꾸기">
      <h2 className="display text-[19px] text-[var(--surface-text)]">이름 바꾸기</h2>
      <p className="mb-4 mt-1.5 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
        동료 주선자에게 보이는 이름입니다. 모임 설정의 주선자 목록과 모임 채팅의 작성자
        이름에 쓰입니다. <b>회원에게는 보이지 않습니다.</b>
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready || busy) return;
          void (async () => {
            setBusy(true);
            setError(null);
            const result = await apiPatch("/api/admin/me", { displayName: value.trim() });
            setBusy(false);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            onClose();
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
            autoFocus
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <FormError>{error}</FormError>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>
            그만두기
          </Button>
          <Button type="submit" disabled={!ready || busy}>
            {busy ? "바꾸는 중…" : "바꾸기"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
