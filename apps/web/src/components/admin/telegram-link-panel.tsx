"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/admin/table";
import { apiDelete, apiPost } from "@/lib/api-client";

type Issued = { code: string; expiresAt: string; deepLink: string | null };

/**
 * 텔레그램 계정 연결 (설계 변경 문서 TELEGRAM v1 §14).
 *
 * 봇은 검색으로 누구나 찾을 수 있으므로 연결된 주선자만 Import 할 수 있다.
 * 발급된 코드는 **이 화면에서 한 번만** 보인다 — 서버는 해시만 저장한다.
 */
export function TelegramLinkPanel({
  enabled,
  connected,
  lastSeenAt,
}: {
  enabled: boolean;
  connected: boolean;
  lastSeenAt: string | null;
}) {
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState(connected);

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
      <Card title="텔레그램 연결">
        <p className="text-[12.5px] text-[var(--surface-text-muted)]">
          텔레그램 Import 채널이 꺼져 있습니다. 운영자에게 문의해 주세요.
        </p>
      </Card>
    );
  }

  return (
    <Card title="텔레그램 연결">
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
            봇에게 프로필 사진을 보내고 이어서 프로필 글을 보내면 여기 Inbox 에 올라옵니다.
            글을 받는 즉시 분석하고, 등록은 검토 후에만 이루어집니다.
          </p>
          <Button variant="ghost" disabled={busy} onClick={() => void unlink()}>
            연결 해제
          </Button>
        </div>
      ) : issued ? (
        <div className="space-y-2.5">
          <p className="text-[12.5px]">
            봇 대화창에 아래 명령을 그대로 보내세요. 이 코드는 다시 볼 수 없습니다.
          </p>
          <code className="block overflow-x-auto rounded-md border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2 text-[12.5px]">
            /start {issued.code}
          </code>
          {issued.deepLink ? (
            <a
              href={issued.deepLink}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-[12.5px] text-[var(--surface-accent)] underline"
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
    </Card>
  );
}
