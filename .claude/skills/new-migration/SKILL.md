---
name: new-migration
description: 새 DB 마이그레이션을 추가한다. 사용자가 스키마 변경, 테이블·컬럼 추가, 인덱스, RLS 정책 변경을 요청할 때 사용한다.
---

# 마이그레이션 추가

**이미 적용된 파일은 절대 고치지 않는다.** 러너가 체크섬으로 거부하고, 가드가 편집을 막는다.
스키마를 바꾸려면 항상 새 번호의 파일을 추가한다.

## 절차

1. 현재 상태를 확인한다.
   ```bash
   ls db/migrations/
   docker exec bolsaram_postgres psql -U bolsaram_owner -d bolsaram -tAc \
     "SELECT filename FROM schema_migrations ORDER BY filename"
   ```
2. 다음 번호로 파일을 만든다: `db/migrations/00NN_<무엇을_하는지>.sql`
3. 파일 맨 위에 **무엇을 왜 바꾸는지** 주석으로 남긴다. 이력이 아니라 의도를 쓴다.
4. 새 테이블이면 아래를 **반드시 함께** 넣는다. 하나라도 빠지면 품질 게이트가 막는다.
   ```sql
   ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
   CREATE POLICY <t>_read ON <t> FOR SELECT USING (...);
   GRANT SELECT, INSERT, UPDATE, DELETE ON <t> TO bolsaram_app;
   -- 시퀀스를 쓰면: GRANT USAGE, SELECT ON SEQUENCE <seq> TO bolsaram_app;
   ```
   RLS 를 켜고 정책을 안 만들면 `bolsaram_app` 이 **전혀 읽지 못한다**(조용히 빈 결과).
   의도적으로 앱 접근을 막는 테이블이라면 `REVOKE ALL ... FROM bolsaram_app` 으로 의도를 명시한다.
5. enum 을 바꾸면 `packages/schemas/src/enums.ts` 를 **같은 턴에** 맞춘다. 한쪽만 바꾸면 런타임에 깨진다.
6. 적용하고 검증한다.
   ```bash
   pnpm db:migrate
   npx vitest run tests/rls.test.ts
   pnpm verify
   ```
7. 정책을 추가·변경했으면 `tests/rls.test.ts` 에 **막히는 케이스**를 추가한다.
   "되는 것"보다 "안 되는 것"을 테스트하는 게 이 프로젝트의 핵심이다.
8. `db/README.md` 의 마이그레이션 표와 테이블 목록을 갱신한다.
   빠뜨리면 `tests/docs-readme.test.ts` 가 실패한다.

## 되돌리기

down 마이그레이션은 두지 않는다. 잘못 적용했으면 되돌리는 새 마이그레이션을 추가하거나,
로컬 개발이면 `pnpm db:reset && pnpm db:migrate && pnpm db:seed` 로 다시 만든다.
`db:reset` 은 데이터를 전부 지우므로 실행 전에 사용자에게 확인받는다.
