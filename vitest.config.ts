import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` 는 클라이언트 번들 유입을 막는 표식일 뿐이다.
      // Node 테스트 러너에서는 의미가 없으므로 빈 모듈로 대체한다.
      "server-only": new URL("./tests/stubs/server-only.ts", import.meta.url).pathname,
    },
  },
  test: {
    // 단위 테스트(도메인/스키마)와 통합 테스트(DB)를 한 번에 돌린다.
    // 통합 테스트는 로컬 Postgres 가 떠 있어야 한다(`pnpm db:up`).
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    // DB 를 공유하므로 파일 간 병렬 실행을 끈다.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
