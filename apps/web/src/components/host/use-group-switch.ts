"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";
import { apiPut } from "@/lib/api-client";

/**
 * 보고 있는 모임 바꾸기.
 *
 * 데스크톱 사이드바 목록(`GroupSwitcher`)과 모바일 상단의 모임 시트가 같은 길을
 * 쓴다. 전환이 끝날 때까지 다음 요청을 막는다 — 서버 왕복 중에 두 번 누르면 어느
 * 쪽이 마지막인지 알 수 없고, 화면은 먼저 돌아온 응답을 따라간다.
 *
 * 값 자체(`users.active_group_id`)는 화면 필터이지 권한이 아니다. 무엇을 볼 수
 * 있는지는 RLS 가 `group_admins` 로 정한다.
 */
export function useGroupSwitch(activeGroupId: string | null) {
  const router = useRouter();
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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

  return { switchTo, busy: busy || pending, error };
}
