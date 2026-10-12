/**
 * 테스트 전용 DB.
 *
 * 통합 테스트는 프로필·계정을 만들었다 지운다. 운영 DB 에서 돌면 지운 뒤에도 공개 번호
 * 시퀀스가 앞으로 가 있고(번호는 재사용하지 않는다), 정리하지 못한 데이터가 실제 화면에
 * 섞인다. 그래서 같은 서버의 `<DB 이름>_test` 로 접속 정보를 바꿔서 돈다.
 */
import { existsSync } from "node:fs";
import path from "node:path";

const SUFFIX = "_test";
const DB_URL_KEYS = ["DATABASE_URL", "APP_DATABASE_URL"] as const;

/** 리포 루트의 .env 를 읽는다. 이미 설정된 값은 덮어쓰지 않는다. */
export function loadRootEnv(): void {
  const root = path.resolve(import.meta.dirname, "..");
  for (const file of [".env", ".env.local"]) {
    const full = path.join(root, file);
    if (existsSync(full)) process.loadEnvFile(full);
  }
}

/** 접속 URL 의 DB 이름을 `_test` 로 끝나게 바꾼다. 이미 그렇다면 그대로 둔다. */
export function toTestDbUrl(url: string): string {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (name.length === 0) throw new Error("DB 접속 URL 에 DB 이름이 없습니다.");
  if (!name.endsWith(SUFFIX)) parsed.pathname = `/${encodeURIComponent(name + SUFFIX)}`;
  return parsed.toString();
}

export function testDbName(url: string): string {
  return decodeURIComponent(new URL(toTestDbUrl(url)).pathname.slice(1));
}

/** 현재 프로세스의 DB 접속 정보를 테스트 DB 로 돌린다. 여러 번 불러도 같다. */
export function useTestDatabase(): void {
  for (const key of DB_URL_KEYS) {
    const value = process.env[key];
    if (value) process.env[key] = toTestDbUrl(value);
  }
}
