"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * 전역 진행 표시.
 *
 * 서버를 한 번 다녀오는 동안 「지금 뭔가 하고 있다」를 알리는 자리다. **화면 흐름
 * 밖에 떠 있다** — 눌린 자리 옆에 문구를 끼워 넣으면 그 줄이 밀려서, 기다리는 동안
 * 사이드바나 목록이 한 줄씩 움직인다(모임 전환에서 실제로 그랬다).
 *
 * 위쪽 가는 띠와 가운데 알약 두 겹으로 그린다. 띠는 눈 끝으로 들어오는 신호이고,
 * 알약은 무엇을 기다리는지 말한다 — 화면을 보지 않는 사용자에게는 `role="status"`
 * 가 같은 문장을 읽어준다.
 *
 * 겹쳐 부를 수 있다. `begin` 이 돌려주는 함수를 부를 때까지 그 작업이 살아 있고,
 * 표시는 **가장 마지막에 시작한 것**을 말한다.
 */

type GlobalProgressValue = {
  /** 진행을 시작하고, 끝낼 때 부를 함수를 돌려준다. */
  begin: (label: string) => () => void;
};

const GlobalProgressContext = createContext<GlobalProgressValue | null>(null);

type Task = { id: number; label: string };

export function GlobalProgressProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const nextId = useRef(0);

  const begin = useCallback((label: string) => {
    const id = nextId.current++;
    setTasks((prev) => [...prev, { id, label }]);
    return () => setTasks((prev) => prev.filter((task) => task.id !== id));
  }, []);

  const value = useMemo(() => ({ begin }), [begin]);

  return (
    <GlobalProgressContext.Provider value={value}>
      {children}
      <GlobalProgressBar label={tasks[tasks.length - 1]?.label ?? null} />
    </GlobalProgressContext.Provider>
  );
}

/**
 * 진행 표시를 쓰는 쪽.
 *
 * 공급자 없이 불러도 터지지 않는다 — 진행 표시가 없는 화면에서도 같은 훅을 쓰는
 * 컴포넌트를 그릴 수 있어야 한다. 그때는 아무것도 그리지 않는다.
 */
export function useGlobalProgress(): GlobalProgressValue {
  return useContext(GlobalProgressContext) ?? NOOP;
}

const NOOP: GlobalProgressValue = { begin: () => () => {} };

function GlobalProgressBar({ label }: { label: string | null }) {
  if (!label) return null;

  // 사이드바(z-30)와 하단 탭 위에 뜬다. 클릭은 통과시킨다 — 기다리는 동안에도
  // 그 아래를 누를 수 있어야 한다.
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center">
      <div className="h-[3px] w-full overflow-hidden bg-[var(--color-rose-200)]">
        <div className="progress-sweep h-full w-2/5 rounded-r-full bg-[var(--color-rose-600)]" />
      </div>
      <p
        role="status"
        className="animate-fade mt-2 rounded-[var(--radius-pill)] border border-[var(--color-rose-200)] bg-[var(--color-ivory-50)]/95 px-3 py-1 text-[12px] text-[var(--color-ink-700)] shadow-[var(--shadow-card)] backdrop-blur"
      >
        {label}
      </p>
    </div>
  );
}
