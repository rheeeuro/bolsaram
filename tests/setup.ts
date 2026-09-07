/** 테스트 공통 설정. 리포 루트의 .env 를 읽어 DB 연결 정보를 채운다. */
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
for (const file of [".env", ".env.local"]) {
  const full = path.join(root, file);
  if (existsSync(full)) process.loadEnvFile(full);
}
