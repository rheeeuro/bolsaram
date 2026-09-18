"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/host/surface";
import { CopyField } from "@/components/ui/copy-field";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Label } from "@/components/ui/field";
import {
  GroupDropdown,
  PUBLIC_GROUP_LABEL,
  type GroupChoice,
} from "@/components/host/group-picker";
import { apiDelete, apiPatch, apiPost } from "@/lib/api-client";

type Issued = { code: string; expiresAt: string; deepLink: string | null };

/**
 * 텔레그램 계정 연결 (설계 변경 문서 TELEGRAM v1 §14). 계정 설정(`/account`)의 한 칸이다 —
 * 연결은 모임이 아니라 사람에게 붙는다.
 *
 * 봇은 검색으로 누구나 찾을 수 있으므로 연결된 주선자만 Import 할 수 있다.
 * 발급된 코드는 **이 화면에서 한 번만** 보인다 — 서버는 해시만 저장한다.
 *
 * **담을 모임도 여기서 정한다.** 웹에서 보고 있는 채널과 별개의 값이라(0039),
 * 다른 모임을 들여다보는 동안 봇으로 사진을 보내도 담기는 곳이 움직이지 않는다.
 * 봇의 `/room` 이 같은 값을 바꾸므로 양쪽이 언제나 같은 방을 가리킨다.
 */
export function TelegramLinkPanel({
  enabled,
  connected,
  lastSeenAt,
  groups,
  uploadGroupId,
}: {
  enabled: boolean;
  connected: boolean;
  lastSeenAt: string | null;
  groups: GroupChoice[];
  uploadGroupId: string | null;
}) {
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState(connected);
  const [uploadGroup, setUploadGroup] = useState<string | null>(uploadGroupId);
  const [groupSaved, setGroupSaved] = useState(false);

  const uploadGroupName = groups.find((g) => g.id === uploadGroup)?.name ?? PUBLIC_GROUP_LABEL;

  async function changeUploadGroup(groupId: string | null) {
    const previous = uploadGroup;
    // 먼저 고른 대로 보여주고, 실패하면 되돌린다 — 한 번 고르는 데 대기 표시가 끼면
    // 고르는 흐름이 끊긴다. 고른 것이 실제로 저장됐는지는 아래 한 줄이 말한다.
    setUploadGroup(groupId);
    setBusy(true);
    setError(null);
    setGroupSaved(false);
    const result = await apiPatch("/api/admin/telegram", { groupId });
    if (result.ok) {
      setGroupSaved(true);
    } else {
      setUploadGroup(previous);
      setError(result.message);
    }
    setBusy(false);
  }

  async function issue() {
    setBusy(true);
    setError(null);
    const result = await apiPost<Issued>("/api/admin/telegram");
    if (result.ok) setIssued(result.data);
    else setError(result.message);
    setBusy(false);
  }

  async function unlink() {
    setBusy(true);
    setError(null);
    const result = await apiDelete("/api/admin/telegram");
    if (result.ok) {
      setLinked(false);
      setIssued(null);
    } else {
      setError(result.message);
    }
    setBusy(false);
  }

  if (!enabled) {
    return (
      <Panel title="텔레그램 연결">
        <p className="text-[12.5px] text-[var(--surface-text-muted)]">
          텔레그램 Import 채널이 꺼져 있습니다. 운영자에게 문의해 주세요.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="텔레그램 연결">
      {linked ? (
        <div className="space-y-2.5">
          <p className="text-[12.5px]">
            연결됨
            {lastSeenAt ? (
              <span className="ml-2 text-[var(--surface-text-muted)]">
                마지막 사용 {new Date(lastSeenAt).toLocaleString("ko-KR")}
              </span>
            ) : null}
          </p>
          <p className="text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]">
            봇에게 프로필 사진을 보내고 이어서 프로필 글을 보내면 「가져오기」 화면에
            올라옵니다. 글을 받는 즉시 분석하고, 등록은 검토 후에만 이루어집니다.
          </p>

          <div className="pt-1">
            {/* label 로 감싸지 않는다 — 안쪽이 입력창이 아니라 여닫는 버튼이다. */}
            <Label hint="고르면 바로 저장됩니다">업로드할 모임</Label>
            <GroupDropdown
              groups={groups}
              value={uploadGroup}
              disabled={busy}
              className="max-w-sm"
              onChange={(groupId) => void changeUploadGroup(groupId)}
            />
            <p
              role="status"
              className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]"
            >
              {busy
                ? "바꾸는 중…"
                : `봇으로 보낸 프로필은 ${uploadGroupName}에 담깁니다${
                    groupSaved ? " — 저장했습니다." : ""
                  }`}
            </p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]">
              화면 위쪽에서 보고 있는 모임을 바꿔도 여기는 그대로입니다. 봇 대화창에서{" "}
              <code>/room</code> 으로도 바꿀 수 있습니다.
            </p>
          </div>

          <ConfirmButton
            variant="ghost"
            label="연결 해제"
            confirmLabel="해제하기"
            message="봇으로 올리던 등록이 함께 취소됩니다. 다시 쓰려면 연결 코드를 새로 받아야 합니다."
            disabled={busy}
            onConfirm={() => void unlink()}
          />
        </div>
      ) : issued ? (
        <div className="space-y-2.5">
          <p className="text-[12.5px]">
            봇 대화창에 아래 명령을 그대로 보내세요. 이 코드는 다시 볼 수 없습니다.
          </p>
          <CopyField value={`/start ${issued.code}`} />
          {issued.deepLink ? (
            <a
              href={issued.deepLink}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-[12.5px] text-[var(--color-rose-600)] underline"
            >
              봇 열고 바로 연결하기
            </a>
          ) : null}
          <p className="text-[11.5px] text-[var(--surface-text-muted)]">
            {new Date(issued.expiresAt).toLocaleTimeString("ko-KR")} 까지 유효
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <p className="text-[12.5px] text-[var(--surface-text-muted)]">
            카카오톡에서 받은 프로필을 텔레그램 봇으로 보내 등록할 수 있습니다. 먼저 계정을
            연결하세요.
          </p>
          <Button disabled={busy} onClick={() => void issue()}>
            {busy ? "발급 중…" : "연결 코드 받기"}
          </Button>
        </div>
      )}

      {error ? <p className="mt-3 text-[12.5px] text-[var(--color-danger)]">{error}</p> : null}
    </Panel>
  );
}
