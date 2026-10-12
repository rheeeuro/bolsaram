/**
 * 실행 전에 한 번 테스트 DB 를 준비한다 — 없으면 만들고 마이그레이션을 끝까지 적용한다.
 *
 * DB 를 지우고 다시 만들지 않는다. 다른 에이전트가 동시에 돌리는 테스트를 끊지 않기 위해서다.
 * 각 테스트는 자기 태그로 만든 것만 정리하므로(README 불변식 3) 남는 것이 있어도 운영과 무관하다.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { closePools, withOwner } from "@bolsaram/db";
import { loadRootEnv, testDbName, toTestDbUrl } from "./test-db";

export default async function setup(): Promise<void> {
  loadRootEnv();
  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) throw new Error("DATABASE_URL 이 필요합니다. 리포 루트 .env 를 확인하세요.");
  const name = testDbName(ownerUrl);

  // 테스트 DB 를 만드는 일만 원래 DB 접속으로 한다. CREATE DATABASE 는 트랜잭션 밖에서 돈다.
  try {
    await withOwner(async (sql) => {
      const found = await sql.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
      if (found.rowCount === 0) await sql.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
    });
  } finally {
    await closePools();
  }

  const appUrl = process.env.APP_DATABASE_URL;
  execFileSync("pnpm", ["--filter", "@bolsaram/db", "migrate"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      DATABASE_URL: toTestDbUrl(ownerUrl),
      ...(appUrl ? { APP_DATABASE_URL: toTestDbUrl(appUrl) } : {}),
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
}
