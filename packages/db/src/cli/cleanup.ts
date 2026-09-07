/**
 * 만료 데이터 정리 실행기. PM2 cron(bolsaram-cleanup)이 매일 04:10 에 돌린다.
 * 로직은 ../cleanup.ts 에 있다 — 테스트가 같은 코드를 쓰도록 분리했다.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePools, withOwner } from "../client.js";
import { runCleanup } from "../cleanup.js";
import { loadDotEnv } from "./dotenv.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

async function main(): Promise<void> {
  loadDotEnv();
  const storageRoot = path.resolve(ROOT, process.env.STORAGE_ROOT ?? "var/storage");
  const startedAt = Date.now();

  // owner 커넥션: 세션·OTP 테이블은 앱 롤에 권한이 없고, 정리는 전 테이블을 훑는다.
  await withOwner(async (sql) => {
    const summary = await runCleanup(sql, storageRoot);
    const elapsed = Date.now() - startedAt;
    console.info(
      summary.length > 0
        ? `정리 완료 (${elapsed}ms)\n` +
            summary.map((s) => `  ${s.label}: ${s.count}건`).join("\n")
        : `정리할 대상 없음 (${elapsed}ms)`,
    );
  });
}

main()
  .then(() => closePools())
  .catch(async (error: unknown) => {
    console.error("정리 작업 실패", error);
    await closePools();
    process.exitCode = 1;
  });
