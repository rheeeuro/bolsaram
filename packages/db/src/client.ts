/**
 * Postgres 커넥션 풀과 RLS 요청 컨텍스트.
 *
 * 두 개의 풀을 분리해서 쓴다.
 *   appPool   — 일반 요청. 반드시 `withRls()` 를 거쳐 GUC 를 세팅한 트랜잭션 안에서만 쓴다.
 *   ownerPool — 마이그레이션/시드/인증(세션·OTP·초대 검증) 전용.
 *
 * ownerPool 은 RLS 를 우회하므로 인증 레이어 밖에서 쓰지 않는다.
 */
import pg from "pg";
import { readDbEnv } from "./env";

const { Pool } = pg;

export type Sql = {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>;
};

// bigint(int8)를 문자열이 아니라 number 로 받는다. audit_logs.id 외에는 쓰지 않는다.
pg.types.setTypeParser(20, (v: string) => Number(v));

type Pools = { app: pg.Pool; owner: pg.Pool };

// Next.js dev 의 모듈 재평가에서 풀이 중복 생성되지 않도록 전역에 붙인다.
const globalForPools = globalThis as typeof globalThis & { __bolsaramPools?: Pools };

function createPools(): Pools {
  const env = readDbEnv();
  const common = { max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 };
  return {
    app: new Pool({ connectionString: env.appUrl, ...common }),
    // owner 풀은 인증 경로에서만 쓰이므로 작게 잡는다.
    owner: new Pool({ connectionString: env.ownerUrl, ...common, max: 4 }),
  };
}

function pools(): Pools {
  globalForPools.__bolsaramPools ??= createPools();
  return globalForPools.__bolsaramPools;
}

export function appPool(): pg.Pool {
  return pools().app;
}

export function ownerPool(): pg.Pool {
  return pools().owner;
}

export async function closePools(): Promise<void> {
  const existing = globalForPools.__bolsaramPools;
  if (!existing) return;
  globalForPools.__bolsaramPools = undefined;
  await Promise.all([existing.app.end(), existing.owner.end()]);
}

/** RLS 정책이 참조하는 요청 컨텍스트. 익명 요청은 둘 다 null. */
export type RlsContext = {
  userId: string | null;
  role: "ADMIN" | "MEMBER" | null;
};

export const ANONYMOUS: RlsContext = { userId: null, role: null };

/**
 * GUC 를 세팅한 트랜잭션 안에서 콜백을 실행한다.
 * `SET LOCAL` 이므로 트랜잭션이 끝나면 값이 사라져 풀 재사용 시 컨텍스트가 새지 않는다.
 * 콜백이 던지면 롤백하고 예외를 그대로 올린다 — 삼키지 않는다.
 */
export async function withRls<T>(ctx: RlsContext, fn: (sql: Sql) => Promise<T>): Promise<T> {
  const client = await appPool().connect();
  try {
    await client.query("BEGIN");
    // set_config 로 넘겨 파라미터 바인딩을 쓴다(SET LOCAL 은 리터럴만 받는다).
    await client.query("SELECT set_config('app.user_id', $1, true)", [ctx.userId ?? ""]);
    await client.query("SELECT set_config('app.role', $1, true)", [ctx.role ?? ""]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      // 롤백 실패는 커넥션이 이미 끊긴 경우다. 원래 에러를 가리지 않도록 무시하고
      // 아래에서 원본을 다시 던진다.
    });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 인증 레이어 전용. RLS 를 우회하므로 세션/OTP/초대 검증 외에는 쓰지 않는다.
 * 호출부는 왜 owner 가 필요한지 주석으로 남긴다.
 */
export async function withOwner<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const client = await ownerPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** owner 커넥션에서 트랜잭션이 필요할 때. */
export async function withOwnerTx<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const client = await ownerPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      // 위와 같은 이유로 원본 에러를 우선한다.
    });
    throw error;
  } finally {
    client.release();
  }
}
