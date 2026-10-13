"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { CopyField } from "@/components/ui/copy-field";
import { FormError } from "@/components/ui/field";
import { Menu, MenuItem } from "@/components/ui/menu";
import { apiDelete, apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";

/**
 * 보고 있는 모임의 이름 — 누르면 그 모임에서 할 수 있는 일이 열린다.
 *
 * 채널 목록 바로 위, 이름이 적힌 자리다. 자주 쓰는 하나(동료 초대)를 맨 위에 두고,
 * 나머지는 설정 화면으로 보낸다. 나가기만 여기 남긴다 — 되돌리기 어려운 일이지만
 * 「이 방을 떠난다」는 이 자리에서 찾는 것이 자연스럽다.
 *
 * 전체공개에는 이 메뉴가 없다. 이름도 주선자도 없는 공용 방이라 설정할 것이 없다
 * (부르는 쪽에서 가른다).
 *
 * 관리자에게는 나가기가 없다 — 어느 모임에도 속하지 않고 모든 모임을 다룬다.
 */
export function GroupMenu({
  groupId,
  groupName,
  asOperator,
}: {
  groupId: string;
  groupName: string;
  asOperator: boolean;
}) {
  const [dialog, setDialog] = useState<"invite" | "leave" | null>(null);

  return (
    <>
      <Menu
        label={`${groupName} 메뉴`}
        panelClassName="min-w-52"
        trigger={(open) => (
          <span
            title={groupName}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
              open ? "bg-[var(--color-ivory-200)]" : "hover:bg-[var(--color-ivory-200)]",
            )}
          >
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
              {groupName}
            </span>
            <span
              aria-hidden
              className="shrink-0 text-[10px] text-[var(--surface-text-muted)]"
            >
              {open ? "▲" : "▼"}
            </span>
          </span>
        )}
      >
        <MenuItem onSelect={() => setDialog("invite")}>주선자 초대 코드</MenuItem>
        <MenuItem href={`/group/${groupId}`}>모임 설정</MenuItem>
        {asOperator ? null : (
          <MenuItem danger onSelect={() => setDialog("leave")}>
            모임 나가기
          </MenuItem>
        )}
      </Menu>

      <InviteDialog
        open={dialog === "invite"}
        groupId={groupId}
        onClose={() => setDialog(null)}
      />
      <LeaveDialog
        open={dialog === "leave"}
        groupId={groupId}
        groupName={groupName}
        onClose={() => setDialog(null)}
      />
    </>
  );
}

/**
 * 동료 주선자 초대 코드. 발급 버튼을 한 번 더 두는 이유는 발급이 **내가 만들어 둔
 * 아직 안 쓴 코드를 무효로 만들기** 때문이다 — 창을 여는 것만으로 이전 코드가 죽으면
 * 이미 전달한 코드가 조용히 못 쓰게 된다.
 */
function InviteDialog({
  open,
  groupId,
  onClose,
}: {
  open: boolean;
  groupId: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} label="주선자 초대 코드">
      <h2 className="display text-[19px] text-[var(--surface-text)]">주선자 초대 코드</h2>
      <p className="mb-4 mt-1.5 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
        동료 주선자를 이 모임에 부릅니다.
      </p>
      {/* 닫으면 발급한 코드를 지운다 — 창을 다시 열 때 새로 그린다. */}
      {open ? <GroupInviteIssuer groupId={groupId} buttonLabel="초대 코드 받기" /> : null}
      <div className="mt-5 flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          닫기
        </Button>
      </div>
    </Dialog>
  );
}

type IssuedInvite = { code: string; expiresAt: string; reusable: boolean };

/**
 * 초대 코드 발급 — 모임 이름 메뉴와 모임 설정이 함께 쓴다.
 *
 * 1회용인지 여러 번 쓰는지는 관리자 설정이 정하고, 발급 응답이 그 코드의 성격을
 * 알려준다. 발급하기 전에는 설정이 바뀌었을 수 있으므로 단정하지 않는다.
 */
export function GroupInviteIssuer({
  groupId,
  buttonLabel,
  compact = false,
}: {
  groupId: string;
  buttonLabel: string;
  /** 설정 화면처럼 다른 패널 사이에 놓일 때 버튼을 작게·보조 색으로 그린다. */
  compact?: boolean;
}) {
  const [issued, setIssued] = useState<IssuedInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setBusy(true);
    setError(null);
    const result = await apiPost<IssuedInvite>(`/api/admin/groups/${groupId}/invite`);
    setBusy(false);
    if (result.ok) setIssued(result.data);
    else setError(result.message);
  }

  return (
    <>
      {issued ? (
        <div className="space-y-2">
          <CopyField value={issued.code} />
          <p className="text-[12.5px] font-medium text-[var(--surface-text)]">
            {issued.reusable
              ? "여러 명이 쓸 수 있는 코드입니다. 만료 전까지 이 코드로 몇 명이든 참여합니다."
              : "1회용 코드입니다. 한 사람만 참여할 수 있습니다."}
          </p>
          <p className="text-[11.5px] text-[var(--surface-text-muted)]">
            {new Date(issued.expiresAt).toLocaleString("ko-KR")} 까지 · 이 창을 닫으면 다시 볼
            수 없습니다
          </p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
            코드는 <b>24시간</b> 동안 쓸 수 있고 발급 직후 한 번만 보입니다. 1회용인지 여러
            명이 쓰는지는 관리자 설정을 따릅니다. 새로 발급하면 내가 만들어 둔 이전 코드는 쓸
            수 없습니다.
          </p>
          <Button
            size={compact ? "sm" : "md"}
            variant={compact ? "secondary" : "primary"}
            disabled={busy}
            onClick={() => void issue()}
          >
            {busy ? "발급 중…" : buttonLabel}
          </Button>
        </>
      )}
      <FormError>{error}</FormError>
    </>
  );
}

/** 모임 나가기. 마지막 주선자는 멤버가 남아 있는 동안 나갈 수 없다(서버가 막는다). */
function LeaveDialog({
  open,
  groupId,
  groupName,
  onClose,
}: {
  open: boolean;
  groupId: string;
  groupName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={open} onClose={onClose} label="모임 나가기">
      <h2 className="display text-[19px] text-[var(--surface-text)]">모임 나가기</h2>
      <p className="mb-4 mt-1.5 text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
        「{groupName}」 의 멤버가 더 이상 보이지 않습니다. 다시 들어오려면 초대 코드가
        필요합니다. 마지막 주선자라면 멤버가 남아 있는 동안 나갈 수 없습니다.
      </p>
      <FormError>{error}</FormError>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          그만두기
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={() =>
            void (async () => {
              setBusy(true);
              setError(null);
              const result = await apiDelete(`/api/admin/groups/${groupId}`);
              setBusy(false);
              if (!result.ok) {
                setError(result.message);
                return;
              }
              onClose();
              router.replace("/home");
              router.refresh();
            })()
          }
        >
          {busy ? "나가는 중…" : "나가기"}
        </Button>
      </div>
    </Dialog>
  );
}
