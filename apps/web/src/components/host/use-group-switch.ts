"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { apiPut } from "@/lib/api-client";
import { useGlobalProgress } from "@/components/ui/global-progress";

/**
 * 보고 있는 모임 바꾸기.
 *
 * 데스크톱 사이드바 목록(`GroupSwitcher`)과 모바일 상단의 모임 시트가 같은 길을
 * 쓴다. 전환이 끝날 때까지 다음 요청을 막는다 — 서버 왕복 중에 두 번 누르면 어느
 * 쪽이 마지막인지 알 수 없고, 화면은 먼저 돌아온 응답을 따라간다.
 *
 * 기다리는 동안의 표시는 **전역 진행 표시**에 맡긴다. 문구를 목록 옆에 끼우면
 * 사이드바가 한 줄씩 밀려서, 전환할 때마다 화면이 들썩인다. 여기서 돌려주는
 * `busy` 는 버튼을 잠그는 데만 쓴다.
 *
 * 값 자체(`users.active_group_id`)는 화면 필터이지 권한이 아니다. 무엇을 볼 수
 * 있는지는 RLS 가 `group_admins` 로 정한다.
 */
export function useGroupSwitch(activeGroupId: string | null) {
  const router = useRouter();
  const { begin } = useGlobalProgress();
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 요청이 끝나고 화면을 다시 받는 동안까지 한 번에 덮는다. 정리 함수가 곧
  // 「끝났다」라서 어느 갈래로 빠져나가든 표시가 남지 않는다.
  const working = busy || pending;
  useEffect(() => (working ? begin("모임으로 이동 중…") : undefined), [working, begin]);

  const switchTo = useCallback(
    async (groupId: string | null, onDone?: () => void) => {
      if (locked.current || pending || groupId === activeGroupId) {
        onDone?.();
        return;
      }
      locked.current = true;
      setBusy(true);
      setError(null);
      const result = await apiPut("/api/admin/groups/active", { groupId });
      if (result.ok) {
        onDone?.();
        startTransition(() => router.refresh());
      } else {
        setError(result.message);
      }
      locked.current = false;
      setBusy(false);
    },
    [activeGroupId, pending, router],
  );

  return { switchTo, busy: working, error };
}
