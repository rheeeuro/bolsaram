"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { GROUP_NAME_MAX_LENGTH } from "@bolsaram/schemas";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/field";
import { apiPost } from "@/lib/api-client";

/**
 * 모임 만들기 · 초대 코드로 참여.
 *
 * 둘 다 입력 한두 개짜리라 화면을 따로 두지 않고 모임 목록 아래 「＋」 에서 창으로
 * 연다 — 만들거나 참여하면 바로 그 모임으로 들어가므로, 목록을 보고 있던 자리에서
 * 그대로 이어진다.
 */

export function GroupCreateDialogs({
  which,
  onClose,
}: {
  which: "create" | "join" | null;
  onClose: () => void;
}) {
  return (
    <>
      <CreateDialog open={which === "create"} onClose={onClose} />
      <JoinDialog open={which === "join"} onClose={onClose} />
    </>
  );
}

/** 만들기·참여 공용 창. */
function FormDialog({
  open,
  onClose,
  title,
  description,
  submitLabel,
  busyLabel,
  busy,
  disabled,
  error,
  onSubmit,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  submitLabel: string;
  busyLabel: string;
  busy: boolean;
  disabled: boolean;
  error: string | null;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} label={title}>
      <h2 className="display text-[19px] text-[var(--surface-text)]">{title}</h2>
      <p className="mb-4 mt-1.5 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
        {description}
      </p>
      <div className="grid gap-3">{children}</div>
      <FormError>{error}</FormError>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          취소
        </Button>
        <Button disabled={busy || disabled} onClick={onSubmit}>
          {busy ? busyLabel : submitLabel}
        </Button>
      </div>
    </Dialog>
  );
}

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="모임 만들기"
      description="모임에 등록한 멤버는 같은 모임 주선자만 봅니다. 만들면 바로 그 모임을 보게 됩니다."
      submitLabel="모임 만들기"
      busyLabel="만드는 중…"
      busy={busy}
      disabled={name.trim().length === 0}
      error={error}
      onSubmit={() =>
        void (async () => {
          setBusy(true);
          setError(null);
          const result = await apiPost("/api/admin/groups", {
            name,
            description: description || undefined,
          });
          setBusy(false);
          if (!result.ok) {
            setError(result.message);
            return;
          }
          setName("");
          setDescription("");
          onClose();
          router.refresh();
        })()
      }
    >
      <Field label="모임 이름" hint={`${GROUP_NAME_MAX_LENGTH}자까지`}>
        <Input
          placeholder="예) 볼사람 강남"
          value={name}
          maxLength={GROUP_NAME_MAX_LENGTH}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="설명" hint="선택. 주선자끼리만 봅니다">
        <Textarea
          placeholder="어떤 분들을 주로 다루는 모임인지 적어두세요."
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-20 text-[12.5px]"
        />
      </Field>
    </FormDialog>
  );
}

function JoinDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="초대 코드로 참여"
      description="동료 주선자에게 받은 코드를 넣으면 그 모임에 합류합니다. 이미 속한 모임이 있어도 됩니다."
      submitLabel="모임 참여"
      busyLabel="참여 중…"
      busy={busy}
      disabled={code.length < 8}
      error={error}
      onSubmit={() =>
        void (async () => {
          setBusy(true);
          setError(null);
          const result = await apiPost("/api/admin/groups/join", { code });
          setBusy(false);
          if (!result.ok) {
            setError(result.message);
            return;
          }
          setCode("");
          onClose();
          router.refresh();
        })()
      }
    >
      <Field label="초대 코드">
        <Input
          placeholder="받은 코드"
          value={code}
          onChange={(e) => setCode(e.target.value.trim())}
        />
      </Field>
    </FormDialog>
  );
}
