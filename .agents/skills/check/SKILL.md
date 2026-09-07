---
name: check
description: 변경 사항을 타입체크·린트·테스트로 검증한다. 사용자가 점검, 품질 게이트, 커밋·PR 전 확인, 또는 검증을 요청할 때 사용한다.
---

# 변경 사항 검증

1. `python3 .agent-config/sync.py --check` 로 Claude/Codex 설정 드리프트를 확인한다.
2. `git status --short` 와 `git diff --stat` 으로 변경 범위를 파악한다.
3. `docker ps --filter name=bolsaram_postgres` 로 DB 가 떠 있는지 확인한다.
   꺼져 있으면 `pnpm db:up` 후 진행한다 — 통합 테스트가 실제 DB 를 쓴다.
4. `pnpm verify` 를 실행한다 (typecheck + lint + test).
   - 특정 패키지만 빠르게 보려면 `pnpm --filter @bolsaram/<pkg> typecheck`
   - 테스트만 좁히려면 `npx vitest run tests/<파일>`
5. 마이그레이션을 추가했으면 `pnpm db:migrate` 로 적용하고
   `npx vitest run tests/rls.test.ts` 로 정책이 의도대로 막는지 확인한다.
6. API 응답 형태나 권한이 바뀌었으면 `run-web` 스킬로 실제 응답을 확인한다.
   특히 **권한 없는 사용자가 못 보는지**를 직접 호출해 확인한다.
7. 실패를 고치고 같은 검증을 다시 통과시킨 뒤에만 완료로 보고한다.

각 명령의 결과를 통과·실패로 간결히 요약한다. 추측으로 통과를 보고하지 않는다.
