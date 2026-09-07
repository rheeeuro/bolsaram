/**
 * 마이그레이션 러너.
 * db/migrations/*.sql 을 파일명 순서대로 한 번씩만 적용하고, 적용 이력과
 * 파일 체크섬을 schema_migrations 에 남긴다. 이미 적용된 파일이 바뀌면 중단한다.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "./dotenv";
import { withOwner } from "../client";
import { closePools } from "../client";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../db/migrations",
);

async function main(): Promise<void> {
  loadDotEnv();
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

  await withOwner(async (sql) => {
    await sql.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = new Map<string, string>();
    const rows = await sql.query<{ filename: string; checksum: string }>(
      "SELECT filename, checksum FROM schema_migrations",
    );
    for (const row of rows.rows) applied.set(row.filename, row.checksum);

    let count = 0;
    for (const filename of files) {
      const body = await readFile(path.join(MIGRATIONS_DIR, filename), "utf8");
      const checksum = createHash("sha256").update(body).digest("hex");
      const previous = applied.get(filename);

      if (previous) {
        if (previous !== checksum) {
          throw new Error(
            `이미 적용된 마이그레이션이 변경되었습니다: ${filename}\n` +
              `기존 파일을 고치는 대신 새 마이그레이션을 추가하세요.`,
          );
        }
        continue;
      }

      // 각 파일을 하나의 트랜잭션으로 적용한다. 중간 실패 시 부분 적용이 남지 않는다.
      await sql.query("BEGIN");
      try {
        await sql.query(body);
        await sql.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", [
          filename,
          checksum,
        ]);
        await sql.query("COMMIT");
      } catch (error) {
        await sql.query("ROLLBACK");
        throw new Error(`마이그레이션 실패: ${filename}\n${String(error)}`, {
          cause: error,
        });
      }
      console.info(`  적용: ${filename}`);
      count += 1;
    }

    console.info(
      count === 0 ? "마이그레이션 없음 (최신 상태)" : `마이그레이션 ${count}개 적용 완료`,
    );
  });
}

main()
  .then(() => closePools())
  .catch(async (error: unknown) => {
    console.error(error);
    await closePools();
    process.exitCode = 1;
  });
