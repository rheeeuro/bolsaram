/**
 * 스키마 초기화. public 스키마를 통째로 지우고 다시 만든다.
 * 개발 전용이며, 실행 전에 확인 문구를 요구한다.
 */
import { closePools, withOwner } from "../client";
import { loadDotEnv } from "./dotenv";

async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env.DATABASE_URL ?? "";
  const isLocal = url.includes("127.0.0.1") || url.includes("localhost");
  if (!isLocal && process.env.ALLOW_REMOTE_RESET !== "yes") {
    throw new Error(
      "원격 데이터베이스로 보입니다. 정말 초기화하려면 ALLOW_REMOTE_RESET=yes 를 설정하세요.",
    );
  }

  await withOwner(async (sql) => {
    await sql.query("DROP SCHEMA public CASCADE");
    await sql.query("CREATE SCHEMA public");
    await sql.query("GRANT ALL ON SCHEMA public TO bolsaram_owner");
    await sql.query("GRANT USAGE ON SCHEMA public TO public");
    console.info("public 스키마를 초기화했습니다. 이어서 `pnpm db:migrate` 를 실행하세요.");
  });
}

main()
  .then(() => closePools())
  .catch(async (error: unknown) => {
    console.error(error);
    await closePools();
    process.exitCode = 1;
  });
