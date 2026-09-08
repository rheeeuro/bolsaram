# @bolsaram/db — 커넥션 풀과 DB CLI

Postgres 커넥션 풀, RLS 요청 컨텍스트, 마이그레이션·시드·정리 CLI.
**RLS 를 강제하는 지점**이라 이 패키지의 규칙이 서비스 전체의 보안 경계를 결정한다.

> **불변식 1: 일반 요청은 반드시 `withRls(ctx, ...)` 를 거친다.**
> `withOwner` / `withOwnerTx` 는 RLS 를 우회하므로 **인증 경로에서만** 쓴다
> (세션·초대·봇 연결 검증 — `sessions` 는 앱 롤에 권한 자체가 없다).
> 그 밖에서 owner 를 쓰면 정책이 통째로 무력화된다. 쓸 때는 왜 필요한지 주석을 남긴다.
>
> **불변식 2: 요청 컨텍스트는 `SET LOCAL` 로만 넘긴다.**
> 트랜잭션이 끝나면 값이 사라져 풀 재사용 시 권한이 새지 않는다. 세션 GUC 를 쓰지 않는다.
>
> **불변식 3: 적용된 마이그레이션은 수정하지 않는다.** 러너가 체크섬으로 거부한다.
>
> 이 README 는 현재 구조의 소스 오브 트루스다. 파일을 추가·삭제하면 함께 갱신한다.
> 작업 규칙은 [`.ai-harness/project.md`](../../.ai-harness/project.md) 를 따른다.

---

## 코드 구조

```
packages/db/src/
├── client.ts       커넥션 풀 2개 + withRls / withOwner / withOwnerTx
├── env.ts          DATABASE_URL · APP_DATABASE_URL 로딩
├── cleanup.ts      만료 데이터 정리 로직 (테스트가 이 모듈을 쓴다)
├── index.ts        client · env 재수출
└── cli/
    ├── migrate.ts  번호순 SQL 적용 + 체크섬 검사
    ├── reset.ts    public 스키마 초기화 (로컬 전용)
    ├── seed.ts     합성 시드 데이터
    ├── cleanup.ts  정리 실행기 (PM2 cron 이 호출)
    └── dotenv.ts   최소 .env 로더 (CLI 전용)
```

---

## 롤 두 개

| 롤               | 커넥션             | 용도                             | RLS             |
| ---------------- | ------------------ | -------------------------------- | --------------- |
| `bolsaram_owner` | `DATABASE_URL`     | 마이그레이션·시드·정리·인증 경로 | 우회            |
| `bolsaram_app`   | `APP_DATABASE_URL` | 모든 일반 요청                   | **NOBYPASSRLS** |

`bolsaram_app` 은 정책을 우회할 수 없다. 그래서 "회원에게 보이는가"는 owner psql 로 판단하면
안 된다 — `tests/rls.test.ts` 나 실제 API 호출로 확인한다.

## `withRls` 가 하는 일

```
BEGIN
  set_config('app.user_id', <uuid>, true)   ← SET LOCAL 과 같음
  set_config('app.role',    <role>, true)
  ...콜백...
COMMIT   (실패 시 ROLLBACK 후 원래 오류를 그대로 올린다)
```

정책은 `app_current_user_id()` · `app_is_admin()` · `app_current_profile_id()` 로 이 값을 읽는다.
익명 요청은 두 값이 모두 NULL 이고, 정책이 NULL 을 거부하므로 **로그인 없이는 아무 프로필도
읽히지 않는다**(`0007_require_auth_for_browse.sql`).

## 마이그레이션 러너

`db/migrations/*.sql` 을 파일명 순서로 한 번씩 적용하고 `schema_migrations` 에 체크섬을 남긴다.
이미 적용된 파일의 내용이 바뀌면 **중단한다** — 부분 적용된 스키마가 조용히 생기는 것보다 낫다.
각 파일은 하나의 트랜잭션으로 적용된다.

## 정리 작업

`cleanup.ts` 는 만료 세션·초대·감사 로그·보낸 알림을 지우고, 오래 방치된 Import 원본
사진을 삭제한다.

못 보낸 알림은 재시도 창(`NOTIFICATION_RETRY_WINDOW_DAYS`)이 지나면 함께 지운다 —
그 창을 넘기면 발송 대상이 아니므로 쌓이기만 한다. 창 값은 도메인에 하나만 두고
발송기와 정리기가 같은 값을 본다.

> **주의: commit 된 Import 는 에셋 파일을 복사하지 않고 같은 `storage_key` 를 프로필 사진으로
> 연결한다.** 세션만 보고 파일을 지우면 게시된 프로필 사진이 깨진다.
> `purgeAbandonedImports()` 가 `profile_images` 를 먼저 조회해 참조된 키를 제외하는 이유다.
> 이 성질은 `tests/cleanup.test.ts` 가 고정한다 — 최적화하더라도 그 테스트는 남긴다.

---

## 명령

```bash
pnpm db:up        # 컨테이너 기동
pnpm db:migrate   # 마이그레이션 적용
pnpm db:seed      # 합성 시드 (실제 인물 정보 금지)
pnpm db:cleanup   # 정리 (평소엔 PM2 cron 이 04:10 에 실행)
pnpm db:reset     # public 스키마 초기화 — 데이터가 전부 사라진다
```

## 유지보수

- 새 테이블에는 `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` + `GRANT ... TO bolsaram_app` 를
  함께 넣는다. 하나라도 빠지면 품질 게이트가 막는다.
- 정리 보존기간은 `cleanup.ts` 의 `RETENTION` 한 곳에 모여 있다.
- 검증: `pnpm --filter @bolsaram/db typecheck`,
  `npx vitest run tests/rls.test.ts tests/cleanup.test.ts`
