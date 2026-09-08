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
| `0009_admin_login_failures.sql`    | 관리자 비밀번호 시도 제한 (실패 기록)                                                  |
| `0010_groups.sql`                  | 모임(테넌트) 격리: `groups` · `group_admins` + 전 정책 재작성                          |
| `0011_public_pool.sql`             | 전체공개 풀: 모임 소속을 선택으로 (`group_id IS NULL` = 전체공개)                      |
| `0012_group_invites.sql`           | 모임 초대 코드 (동료 주선자 합류)                                                      |
| `0013_drop_open_claim.sql`         | `profiles_claim` 제거 — 누구나 주인 없는 프로필을 가져갈 수 있었다                     |
| `0014_group_description.sql`       | 모임 설명 (주선자끼리 보는 메모)                                                       |
| `0015_magic_link_login.sql`        | 회원 로그인을 매직 링크로 — `login_codes` 제거, 전화번호 필수 해제                     |
| `0016_invite_claim_pair.sql`       | `invites_claim_pair` 완화 — 링크를 쓴 회원을 삭제할 수 있게                            |
| `0017_notifications.sql`           | 알림 아웃박스: `notifications` + 신청·수락 트리거 (담당 주선자에게)                    |
| `0018_notifications_readonly.sql`  | 알림은 런타임 롤에서 읽기 전용 (기본 권한으로 딸려온 DML 회수)                         |
| `0019_profile_consent.sql`         | 등록 동의 기록 (0020 에서 되돌림)                                                      |
| `0020_drop_profile_consent.sql`    | 동의 기록 제거 + 시드 표식(`is_seed`)만 남김                                           |
| `0021_auto_introduce_on_accept.sql`| 수락이 곧 연결 — 주선자 연결 게이트 제거, 알림 트리거를 INTRODUCED 기준으로            |
| `0022_disclosure_survives_close.sql`| 종료해도 이름·연락처 공개 유지 (`app_is_introduced_with` 에 CLOSED 포함)               |
| `0023_reject_and_hide.sql`         | 거절 관계 재신청 금지 + `profile_hides` (숨기기). 둘 다 양방향                         |
| `0024_hide_requires_no_active_request.sql` | 활성 신청이 있는 상대는 숨길 수 없다 (0023 의 반대 방향)                       |

## 테이블

| 테이블                                         | 역할                                               | 앱 롤 접근                          |
| ---------------------------------------------- | -------------------------------------------------- | ----------------------------------- |
| `groups`                                       | 모임. 이름·설명. 가입과 별개로 만든다              | 소속 주선자 + 소속 회원             |
| `group_admins`                                 | 모임 ↔ 주선자 (여러 명 가능, OWNER 한 명)          | 같은 모임 주선자만 조회             |
| `users`                                        | 계정 (ADMIN 이메일/비밀번호, MEMBER 전화)          | 본인 + 같은 모임 관계자             |
| `profiles`                                     | 프로필. `public_code` 가 화면의 `#17`, `is_seed` 는 합성 표식 | 공개분 + 본인 + 관리자   |
| `profile_images`                               | 사진 메타데이터 (`storage_key` 만, URL 저장 안 함) | 부모 프로필을 읽을 수 있으면        |
| `match_requests`                               | 소개 신청과 상태                                   | 당사자 + 관리자                     |
| `favorites`                                    | 관심                                               | 본인만                              |
| `profile_hides`                                | 숨긴 상대. 양방향으로 목록·신청을 막는다           | **숨긴 사람만** (상대·관리자 불가)  |
| `invites`                                      | **회원 로그인 링크** (토큰 해시만 저장)            | 관리자만                            |
| `import_sessions` / `_assets` / `_extractions` | Import 파이프라인                                  | 관리자만                            |
| `audit_logs`                                   | 감사 기록                                          | 쓰기는 인증된 누구나, 읽기는 관리자 |
| `notifications`                                | 알림 아웃박스. 트리거가 만들고 디스패처가 보낸다   | 받는 사람이 **읽기만**              |
| `telegram_connections`                         | 텔레그램 계정 ↔ 주선자 연결                        | 관리자만                            |
| `telegram_import_sessions`                     | 봇 대화 상태 (ImportSession 과 1:1)                | 관리자만                            |
| `sessions`                                     | 세션                                               | **권한 없음** (owner 커넥션 전용)   |
| `telegram_link_codes` · `telegram_webhook_events` | 봇 연결 코드(해시) · webhook 중복 판정          | **권한 없음** (owner 커넥션 전용)   |
| `group_invite_codes`                           | 모임 초대 코드(해시). 동료 주선자 합류             | **권한 없음** (owner 커넥션 전용)   |
| `admin_login_failures`                         | 관리자 로그인 실패 기록 (시도 제한 판정)           | **권한 없음** (owner 커넥션 전용)   |

## 무결성을 DB 가 지키는 것

코드에 맡기지 않고 스키마로 고정한 규칙들이다.

| 제약                                                 | 막는 것                                       |
| ---------------------------------------------------- | --------------------------------------------- |
| `match_requests_one_active` (부분 유니크)            | 같은 방향 활성 신청 중복 — 동시 요청도 막힌다 |
| `match_requests_no_self`                             | 자기 자신에게 신청                            |
| `match_requests_block_closed_relations_trg`          | 거절·숨김 관계의 새 신청 (양방향)             |
| `profile_hides_block_active_request_trg`             | 활성 신청이 있는 상대를 숨기기                |
| `profile_hides_no_self`                              | 자기 자신을 숨기기                            |
| `profile_images_one_primary` (부분 유니크)           | 대표 사진 두 장                               |
| `profiles.user_id` UNIQUE                            | 한 계정에 프로필 두 개                        |
| `invites_one_open` (부분 유니크)                     | 프로필당 살아 있는 초대 두 개                 |
| `import_sessions_idempotency` (부분 유니크)          | 같은 키로 두 번 commit                        |
| `import_sessions_commit_pair`                       | 짝이 안 맞는 commit 상태                      |
| `invites_claim_pair`                                | 쓴 사람은 있는데 쓴 시각이 없는 상태          |
| `telegram_import_sessions_one_active` (부분 유니크) | 한 텔레그램 사용자의 대화 두 개 — 사진이 한 세션에 묶이는 근거 |
| `telegram_link_codes_one_open` (부분 유니크)        | 주선자당 살아 있는 연결 코드 두 개            |
| `telegram_webhook_events.update_id` PK              | 같은 webhook update 두 번 처리                |
| `telegram_connections` 양방향 UNIQUE                | 계정 하나에 텔레그램 두 개 / 그 반대          |
| `group_admins_one_owner` (부분 유니크)              | 모임당 OWNER 두 명                            |
| `notifications_dedupe_idx` (부분 유니크)            | 같은 사건으로 같은 사람에게 두 번 알림        |
| `profiles.group_id` · `import_sessions.group_id` NOT NULL | 소속 없는 데이터 — 격리를 우회하는 구멍 |

`match_requests_stamp` 트리거가 상태 전이 시각(`responded_at` · `introduced_at` · `closed_at`)을
DB 에서 채운다. 코드가 빠뜨려도 기록이 남는다.

`match_requests_notify_created` · `match_requests_notify_introduced` 트리거가 담당 주선자
(`app_profile_admins()`)에게 보낼 알림을 `notifications` 에 넣는다. 전이가 실제로 성공했을
때만 돌기 때문에 애플리케이션이 알림을 빠뜨릴 수 없다.

`match_requests_block_closed_relations` 트리거가 거절·숨김 관계의 새 신청을 막는다. 판정은
방향을 구분하지 않는다 — 한쪽만 막으면 탐색 목록에서 서로 빠지는 것과 어긋난다.
`app_discover_excluded_profile_ids()` 가 같은 관계를 목록 쿼리에 알려주고,
`app_is_rejected_between()` · `app_is_hidden_between()` 이 화면의 버튼 상태를 정한다.
숨김 판정 함수들이 `SECURITY DEFINER` 인 이유는 **누가 숨겼는지는 정책으로 가려 두고**
판정만 내보내기 위해서다.

`profile_hides_block_active_request` 트리거가 그 반대 방향을 막는다 — 활성 신청이 있는
상대는 숨기지 못한다. 두 트리거가 함께 있어야 「숨김 + 활성 신청」이 어느 순서로도
만들어지지 않는다. 그 조합은 회원이 스스로 되돌릴 수 없는 상태다.

## RLS 요약

정책은 `app_current_user_id()` · `app_is_admin()` · `app_current_profile_id()` 를 참조한다.
값은 `withRls()` 가 `SET LOCAL` 로 넣는다.

**소속 여부가 곧 공개 여부다.**

```
group_id IS NULL      → 전체공개. 모든 주선자가 본다(고치는 건 등록한 주선자만).
group_id IS NOT NULL  → 그 모임 주선자만 본다.
```

주선자 가입이 자유롭게 열려 있으므로 관리자 조건은 `app_is_admin()` 이 될 수 없다.
**읽기와 쓰기를 다르게 준다** — 전체공개 프로필은 누구나 보지만 남이 고칠 수 없다.

| 함수                                   | 판정                                                |
| -------------------------------------- | --------------------------------------------------- |
| `app_is_group_admin(uuid)`             | 그 모임의 주선자인가                                |
| `app_can_view_profile_as_admin(uuid)`  | 전체공개이거나 자기 모임인가 (읽기)                 |
| `app_can_edit_profile(uuid)`           | 자기 모임이거나, 전체공개인데 자기가 등록했는가     |
| `app_can_edit_import(uuid)`            | 위와 같은 판정을 Import 세션에                      |
| `app_current_member_group()`           | 현재 회원이 속한 풀 (전체공개 회원은 NULL)          |
| `app_profile_admins(uuid)`             | 그 프로필의 담당 주선자 집합 (알림 수신자)          |

- 익명(둘 다 NULL)은 어떤 프로필도 읽지 못한다.
- 모임에 속하지 않은 주선자는 아무 데이터도 보지 못한다.
- 회원은 **자기와 같은 풀** 안의 공개 프로필만 보고, 풀을 넘는 소개 신청은 만들 수 없다
  (`IS NOT DISTINCT FROM` 이라 전체공개 회원끼리도 서로 보인다).
- **claim 정책은 없다.** 주인 없는 프로필을 자기 것으로 만드는 것은 해시된 초대 토큰을
  검증하는 인증 레이어(owner 커넥션)에서만 일어난다. 정책으로 열어두면 초대 없이도
  남의 프로필을 가져갈 수 있다(0013 에서 제거).
- 회원은 공개 프로필과 자기 프로필만 읽고, 프로필을 만들거나 남의 것을 고칠 수 없다.
- 신청은 **자기 명의로만** 만들 수 있다(`requester_profile_id = app_current_profile_id()`).
- Import·초대는 관리자 전용이다.
- 텔레그램 봇 대화·계정 연결도 관리자 전용이다. webhook 은 **RLS 를 우회하지 않는다** —
  신원 확인만 owner 커넥션으로 하고, 그 뒤 모든 접근은 연결된 주선자 명의로 정책을 통과한다.
- 봇 연결 코드와 webhook 이벤트 테이블은 `sessions` 와 같은 취급이다.
  정책을 주지 않고 권한을 회수해 런타임 롤이 아예 접근하지 못한다.
- `notifications` 는 **읽기만** 열려 있고 그마저 받는 사람 본인으로 제한된다. 만드는 것은
  트리거(owner 소유 SECURITY DEFINER), 보냈다고 표시하는 것은 디스패처(owner)뿐이다 —
  정책과 권한 회수로 두 겹을 걸었다.

`tests/rls.test.ts` 22개, `tests/group-isolation.test.ts` 11개,
`tests/notifications.test.ts` 11개, `tests/telegram-import.test.ts` 의 「권한 경계」가
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
