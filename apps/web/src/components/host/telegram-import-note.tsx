import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Panel } from "@/components/host/surface";

/**
 * 「가져오기」에 있는 텔레그램 봇 상태 한 줄.
 *
 * 연결을 여기서 하지 않는다 — 연결은 계정에 붙는 것이라 계정 설정(`/account`)에 있다.
 * 그래도 **상태와 담기는 모임**은 이 화면에 보여준다. 봇으로 보낸 프로필이 올라오는
 * 목록이 바로 옆이라, 안 올라올 때 이유(연결 안 됨·다른 모임에 담김)를 여기서 알아야
 * 한다.
 */
export function TelegramImportNote({
  connected,
  uploadGroupName,
}: {
  connected: boolean;
  /** 봇으로 보낸 프로필이 담기는 곳. 연결돼 있을 때만 쓴다. */
  uploadGroupName: string;
}) {
  return (
    <Panel title="텔레그램 봇">
      {connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12.5px] text-[var(--surface-text)]">
              연결됨 · 봇으로 보낸 프로필은{" "}
              <b className="text-[var(--color-rose-600)]">{uploadGroupName}</b>에 담깁니다
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--surface-text-muted)]">
              봇에게 사진을 보내고 이어서 프로필 글을 보내면 이 목록에 올라옵니다.
            </p>
          </div>
          <Link
            href="/account"
            className={buttonClasses({ variant: "ghost", size: "sm" })}
          >
            연결 설정
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 max-w-sm text-[12.5px] leading-relaxed text-[var(--surface-text-muted)]">
            볼사람을 열지 않고 <b>텔레그램 봇</b>에게 보내 올릴 수도 있습니다. 먼저 계정을
            연결하세요.
          </p>
          <Link
            href="/account"
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            봇 연결하기
          </Link>
        </div>
      )}
    </Panel>
  );
}
