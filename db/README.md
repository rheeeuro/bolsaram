# db — 스키마와 마이그레이션

Postgres 스키마 전체. 순수 SQL 파일을 번호순으로 적용한다. ORM 도, 자동 생성기도 쓰지 않는다 —
RLS 정책과 부분 인덱스를 직접 다뤄야 하기 때문이다.

> **불변식 1: 적용된 파일은 절대 수정하지 않는다.**
> 러너가 체크섬으로 거부하고, 에이전트 가드가 편집을 막는다.
> 스키마를 바꾸려면 **다음 번호의 새 파일**을 추가한다.
>
> **불변식 2: 새 테이블에는 RLS 를 함께 넣는다.**
> `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` + `GRANT ... TO bolsaram_app`.
> 정책 없이 RLS 만 켜면 앱 롤이 **아무것도 못 읽는다**(빈 결과로 조용히 깨진다).
> 의도적으로 앱 접근을 막는 테이블이면 `REVOKE` 로 의도를 명시한다.
>
> **불변식 3: enum 은 `packages/schemas/src/enums.ts` 와 1:1 이다.** 한쪽만 바꾸지 않는다.
>
> 이 README 는 현재 스키마의 소스 오브 트루스다. 마이그레이션을 추가하면 함께 갱신한다.
> 작업 규칙은 [`.ai-harness/project.md`](../.ai-harness/project.md) 를 따른다.

---

## 마이그레이션

| 파일                               | 내용                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| `0001_extensions_and_roles.sql`    | pgcrypto·citext, `bolsaram_app` 롤, RLS 컨텍스트 함수, `set_updated_at`                |
| `0002_enums.sql`                   | 도메인 enum 12종                                                                       |
| `0003_core_tables.sql`             | `users` · `profiles` · `profile_images`                                                |
| `0004_match_and_social.sql`        | `match_requests` · `favorites` · `invites` · `sessions` · `login_codes` · `audit_logs` |
| `0005_import.sql`                  | `import_sessions` · `import_assets` · `import_extractions` + 최신 추출 뷰              |
| `0006_rls.sql`                     | 전 테이블 RLS 정책 + 권한 부여                                                         |
| `0007_require_auth_for_browse.sql` | 익명 열람 차단 (로그인 없이는 프로필 0건)                                              |
| `0008_telegram.sql`                | 텔레그램 Import 채널: 계정 연결·연결 코드·봇 대화·webhook 이벤트                       |

## 테이블

| 테이블                                         | 역할                                               | 앱 롤 접근                          |
| ---------------------------------------------- | -------------------------------------------------- | ----------------------------------- |
| `users`                                        | 계정 (ADMIN 이메일/비밀번호, MEMBER 전화)          | 본인 + 관리자                       |
| `profiles`                                     | 프로필. `public_code` 가 화면의 `#17`              | 공개분 + 본인 + 관리자              |
| `profile_images`                               | 사진 메타데이터 (`storage_key` 만, URL 저장 안 함) | 부모 프로필을 읽을 수 있으면        |
| `match_requests`                               | 소개 신청과 상태                                   | 당사자 + 관리자                     |
| `favorites`                                    | 관심                                               | 본인만                              |
| `invites`                                      | 초대 (토큰 해시만 저장)                            | 관리자만                            |
| `import_sessions` / `_assets` / `_extractions` | Import 파이프라인                                  | 관리자만                            |
| `audit_logs`                                   | 감사 기록                                          | 쓰기는 인증된 누구나, 읽기는 관리자 |
| `telegram_connections`                         | 텔레그램 계정 ↔ 주선자 연결                        | 관리자만                            |
| `telegram_import_sessions`                     | 봇 대화 상태 (ImportSession 과 1:1)                | 관리자만                            |
| `sessions` · `login_codes`                     | 세션·OTP                                           | **권한 없음** (owner 커넥션 전용)   |
| `telegram_link_codes` · `telegram_webhook_events` | 봇 연결 코드(해시) · webhook 중복 판정          | **권한 없음** (owner 커넥션 전용)   |

## 무결성을 DB 가 지키는 것

코드에 맡기지 않고 스키마로 고정한 규칙들이다.

| 제약                                                 | 막는 것                                       |
| ---------------------------------------------------- | --------------------------------------------- |
| `match_requests_one_active` (부분 유니크)            | 같은 방향 활성 신청 중복 — 동시 요청도 막힌다 |
| `match_requests_no_self`                             | 자기 자신에게 신청                            |
| `profile_images_one_primary` (부분 유니크)           | 대표 사진 두 장                               |
| `profiles.user_id` UNIQUE                            | 한 계정에 프로필 두 개                        |
| `invites_one_open` (부분 유니크)                     | 프로필당 살아 있는 초대 두 개                 |
| `import_sessions_idempotency` (부분 유니크)          | 같은 키로 두 번 commit                        |
| `invites_claim_pair` · `import_sessions_commit_pair` | 짝이 안 맞는 상태 (claim 됐는데 주인 없음 등) |
| `telegram_import_sessions_one_active` (부분 유니크) | 한 텔레그램 사용자의 대화 두 개 — 사진이 한 세션에 묶이는 근거 |
| `telegram_link_codes_one_open` (부분 유니크)        | 주선자당 살아 있는 연결 코드 두 개            |
| `telegram_webhook_events.update_id` PK              | 같은 webhook update 두 번 처리                |
| `telegram_connections` 양방향 UNIQUE                | 계정 하나에 텔레그램 두 개 / 그 반대          |

`match_requests_stamp` 트리거가 상태 전이 시각(`responded_at` · `introduced_at` · `closed_at`)을
DB 에서 채운다. 코드가 빠뜨려도 기록이 남는다.

## RLS 요약

정책은 `app_current_user_id()` · `app_is_admin()` · `app_current_profile_id()` 를 참조한다.
값은 `withRls()` 가 `SET LOCAL` 로 넣는다.

- 익명(둘 다 NULL)은 어떤 프로필도 읽지 못한다.
- 회원은 공개 프로필과 자기 프로필만 읽고, 프로필을 만들거나 남의 것을 고칠 수 없다.
- 신청은 **자기 명의로만** 만들 수 있다(`requester_profile_id = app_current_profile_id()`).
- Import·초대는 관리자 전용이다.
- 텔레그램 봇 대화·계정 연결도 관리자 전용이다. webhook 은 **RLS 를 우회하지 않는다** —
  신원 확인만 owner 커넥션으로 하고, 그 뒤 모든 접근은 연결된 주선자 명의로 정책을 통과한다.
- 봇 연결 코드와 webhook 이벤트 테이블은 `sessions`·`login_codes` 와 같은 취급이다.
  정책을 주지 않고 권한을 회수해 런타임 롤이 아예 접근하지 못한다.

`tests/rls.test.ts` 22개와 `tests/telegram-import.test.ts` 의 「권한 경계」가
실제 DB 에 붙어 검증한다.

## 새 마이그레이션 추가

`new-migration` 스킬을 쓰거나 아래를 따른다.

```bash
ls db/migrations/                       # 다음 번호 확인
# db/migrations/00NN_<무엇을_하는지>.sql 작성
pnpm db:migrate                         # 적용
npx vitest run tests/rls.test.ts        # 정책 확인
```

정책을 추가·변경했으면 `tests/rls.test.ts` 에 **막히는 케이스**를 넣는다.
"되는 것"보다 "안 되는 것"을 테스트하는 게 이 프로젝트의 핵심이다.

down 마이그레이션은 두지 않는다. 되돌리려면 되돌리는 새 파일을 추가하거나,
로컬이면 `pnpm db:reset && pnpm db:migrate && pnpm db:seed` 로 다시 만든다.
