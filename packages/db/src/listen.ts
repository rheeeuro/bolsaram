/**
 * `LISTEN` 전용 커넥션.
 *
 * 풀을 쓰지 않는다 — `LISTEN` 은 **세션에 붙는** 구독이라 커넥션을 반납하면 사라진다.
 * 그래서 채널마다 커넥션 하나를 붙잡고 산다. 프로세스당 하나면 충분하다.
 *
 * 앱 롤(`bolsaram_app`)로 붙는다. 이 커넥션은 데이터를 읽지 않고 채널만 듣는다 —
 * owner 가 필요할 이유가 없고, 인증 밖에서 owner 를 쓰지 않는다는 규칙에도 맞다.
 * 여기로 오는 payload 는 권한 판정을 거치지 않았으므로, 받는 쪽이 **자기 컨텍스트로
 * 다시 읽어야** 한다.
 *
 * 끊기면 스스로 다시 붙는다. DB 가 잠깐 재시작해도 구독이 영영 죽지 않아야 한다.
 */
import pg from "pg";
import { readDbEnv } from "./env";

const { Client } = pg;

/** 재연결 대기. 붙을 때까지 늘어나되 이 값에서 멈춘다. */
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

export type Listener = {
  /**
   * 첫 구독이 실제로 걸렸을 때 끝난다. 그 전에 일어난 사건은 받지 못하므로,
   * 「구독하고 나서 무엇을 한다」가 필요한 곳(테스트·기동 순서)이 이 값을 기다린다.
   * 첫 연결이 실패해도 재연결이 성공하면 끝난다.
   */
  ready: Promise<void>;
  /** 구독을 끊고 커넥션을 닫는다. 이후 재연결하지 않는다. */
  close(): Promise<void>;
};

/**
 * 채널 하나를 듣는다. `onPayload` 는 `NOTIFY` 의 payload 문자열을 그대로 받는다.
 * 파싱과 검증은 호출부의 몫이다 — 외부에서 들어오는 값과 같은 규칙으로 다룬다.
 */
export function listen(channel: string, onPayload: (payload: string) => void): Listener {
  let client: pg.Client | null = null;
  let closed = false;
  let retryMs = RETRY_MIN_MS;
  let timer: NodeJS.Timeout | null = null;

  let markReady: () => void;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  async function connect(): Promise<void> {
    if (closed) return;
    const next = new Client({ connectionString: readDbEnv().appUrl });
    client = next;

    next.on("notification", (message) => {
      if (message.channel === channel && message.payload) onPayload(message.payload);
    });
    // 커넥션이 끊기는 모든 경로가 여기로 온다. 던지지 않고 다시 붙는다.
    next.on("error", (error: Error) => {
      console.error(`LISTEN ${channel} 커넥션 오류: ${error.message}`);
      scheduleRetry();
    });
    next.on("end", () => scheduleRetry());

    try {
      await next.connect();
      await next.query(`LISTEN ${pg.escapeIdentifier(channel)}`);
      retryMs = RETRY_MIN_MS;
      markReady();
    } catch (error) {
      console.error(
        `LISTEN ${channel} 연결 실패: ${error instanceof Error ? error.message : error}`,
      );
      scheduleRetry();
    }
  }

  function scheduleRetry(): void {
    if (closed || timer) return;
    const current = client;
    client = null;
    // 이미 끊긴 커넥션을 닫는 것은 실패해도 상관없다.
    void current?.end().catch(() => {});

    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, retryMs);
    timer.unref();
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
  }

  void connect();

  return {
    ready,
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      const current = client;
      client = null;
      await current?.end().catch(() => {});
    },
  };
}
