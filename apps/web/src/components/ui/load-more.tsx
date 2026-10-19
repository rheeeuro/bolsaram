"use client";

import { useEffect, useRef } from "react";
import { Button } from "./button";

/**
 * 무한 스크롤의 끝자리. 목록 아래에 두면 화면 끝에 가까워질 때 `onLoad` 를 부른다.
 *
 * 불러오기가 끝날 때마다 관찰을 새로 건다 — 새로 건 관찰은 지금 보이는지를 곧바로
 * 알려 주므로, 붙은 항목이 화면을 다 못 채운 큰 화면에서도 다음 페이지가 이어진다.
 * 실패하면 자동으로 다시 부르지 않고 버튼을 둔다(같은 오류로 계속 두드리지 않는다).
 */
export function LoadMore({
  hasMore,
  loading,
  error,
  onLoad,
}: {
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  onLoad: () => void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  // 관찰 콜백이 매 렌더의 onLoad 를 잡도록 한다 — 관찰을 onLoad 마다 새로 걸지 않는다.
  const latestOnLoad = useRef(onLoad);
  useEffect(() => {
    latestOnLoad.current = onLoad;
  });

  const waiting = hasMore && !loading && !error;
  useEffect(() => {
    const node = sentinel.current;
    if (!waiting || !node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latestOnLoad.current();
      },
      // 끝에 닿기 전에 미리 부른다 — 사진이 뜨는 동안 빈 바닥을 보지 않게.
      { rootMargin: "0px 0px 600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [waiting]);

  if (!hasMore) return <div className="h-8" />;

  return (
    <div ref={sentinel} className="flex justify-center py-8">
      {error ? (
        <div className="flex flex-col items-center gap-2">
          <p role="alert" className="text-[12.5px] text-[var(--color-ink-600)]">
            {error}
          </p>
          <Button variant="secondary" onClick={onLoad}>
            다시 불러오기
          </Button>
        </div>
      ) : (
        // 기다리는 동안에만 글자가 찬다. 평소엔 자리만 차지해 관찰 대상이 된다.
        <p role="status" className="min-h-5 text-[12.5px] text-[var(--color-ink-500)]">
          {loading ? "불러오는 중…" : ""}
        </p>
      )}
    </div>
  );
}
