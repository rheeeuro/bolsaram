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

이 디렉터리에는 마이그레이션 외에 `sample/` 이 있다 — 시드가 읽는 샘플 프로필
(사람 하나당 디렉터리 하나, `profile.txt` + 사진)이며 **git 에 올라가지 않는다.**
읽는 쪽은 `packages/db/src/cli/seed.ts` 다.

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
| `0009_admin_login_failures.sql`    | 관리자 비밀번호 시도 제한 (실패 기록) — 0050 에서 제거                                  |
| `0010_groups.sql`                  | 모임(테넌트) 격리: `groups` · `group_admins` + 전 정책 재작성                          |
| `0011_public_pool.sql`             | 전체공개 풀: 모임 소속을 선택으로 (`group_id IS NULL` = 전체공개)                      |
| `0012_group_invites.sql`           | 모임 초대 코드 (동료 주선자 합류)                                                      |
| `0013_drop_open_claim.sql`         | `profiles_claim` 제거 — 누구나 주인 없는 프로필을 가져갈 수 있었다                     |
| `0014_group_description.sql`       | 모임 설명 (주선자끼리 보는 메모)                                                       |
| `0015_magic_link_login.sql`        | 멤버 로그인을 매직 링크로 — `login_codes` 제거, 전화번호 필수 해제                     |
| `0016_invite_claim_pair.sql`       | `invites_claim_pair` 완화 — 링크를 쓴 멤버를 삭제할 수 있게                            |
| `0017_notifications.sql`           | 알림 아웃박스: `notifications` + 신청·수락 트리거 (담당 주선자에게)                    |
| `0018_notifications_readonly.sql`  | 알림은 런타임 롤에서 읽기 전용 (기본 권한으로 딸려온 DML 회수)                         |
| `0019_profile_consent.sql`         | 등록 동의 기록 (0020 에서 되돌림)                                                      |
| `0020_drop_profile_consent.sql`    | 동의 기록 제거 + 시드 표식(`is_seed`)만 남김                                           |
| `0021_auto_introduce_on_accept.sql`| 수락이 곧 연결 — 주선자 연결 게이트 제거, 알림 트리거를 INTRODUCED 기준으로            |
| `0022_disclosure_survives_close.sql`| 종료해도 이름·연락처 공개 유지 (`app_is_introduced_with` 에 CLOSED 포함)               |
| `0023_reject_and_hide.sql`         | 거절 관계 재신청 금지 + `profile_hides` (숨기기). 둘 다 양방향                         |
| `0024_hide_requires_no_active_request.sql` | 활성 신청이 있는 상대는 숨길 수 없다 (0023 의 반대 방향)                       |
| `0025_acting_profile.sql`          | 주선자 대행 — `sessions.acting_profile_id` + `app_current_profile_id()` 대행 분기      |
| `0026_match_intents.sql`           | `match_intents` — 멤버의 의사는 요청이고 확정은 주선자가 한다                          |
| `0027_match_request_admin_both_sides.sql` | 신청 읽기·수정을 **양쪽** 담당 주선자에게                                       |
| `0028_admin_creates_request_on_approval.sql` | 담당 주선자가 멤버를 대신해 신청을 만든다 (승인 경로)                       |
| `0029_intent_notification_payload.sql` | 요청 알림 payload 키를 아웃박스가 읽는 이름으로                                 |
| `0030_hide_declined_intent_targets.sql` | 보류된 「마음 보내기」의 상대를 그 멤버 목록에서 뺀다 (한 방향)               |
| `0031_intent_declined_notification.sql` | 보류를 그 멤버의 담당 주선자에게 알린다 (누른 사람 제외)                     |
| `0032_match_rejected_notification.sql` | 거절을 **신청자 쪽** 담당 주선자에게 알린다 (누른 사람 제외)                    |
| `0033_match_canceled_notification.sql` | 취소를 **받는 쪽** 담당 주선자에게 알린다 (누른 사람 제외)                      |
| `0034_profile_images_owner_write.sql` | 사진 쓰기를 `app_is_admin()` 에서 `app_can_edit_profile` 로 조인다              |
| `0035_acting_allows_claimed_profile.sql` | 본인 계정이 연결된 프로필도 대행 대상 — `app_current_profile_id()` 에서 연결 조건 제거 |
| `0036_multi_group_admins.sql`      | 주선자 다중 소속 + 보고 있는 모임(`users.active_group_id`)                              |
| `0037_group_invite_consume_pair.sql` | `group_invite_codes_consume_pair` 완화 — 코드를 쓴 주선자를 삭제할 수 있게             |
| `0038_admin_transition_scope.sql`  | 신청 전이를 담당별로 — 수락·거절은 받은 쪽, 취소는 신청자 쪽. 거절·숨김 판정 2인자 형태 |
| `0039_telegram_upload_group.sql`   | 봇이 담을 모임을 연결 설정에 둔다(`telegram_connections.upload_group_id`)               |
| `0040_group_chat.sql`              | 모임 채팅방(주선자 전용): `group_messages` · `group_chat_prefs` + 새 글 알림             |
| `0041_group_message_author_cleared.sql` | 계정 삭제 시 메시지의 작성자만 비우도록 가드 트리거 완화                            |
| `0042_group_chat_millisecond_cursors.sql` | 채팅 시각을 `timestamptz(3)` 로 — 화면이 들고 있는 ISO 커서와 정밀도를 맞춘다     |
| `0043_group_chat_notify.sql`       | 채팅 변화를 `pg_notify` 로 알린다 — 화면에 밀어주는 SSE 의 뿌리                          |
| `0044_group_chat_system_messages.sql` | 방에 남는 사건 — 주선자 입·퇴장, 멤버 등록, 신청·연결. 사람은 만들지도 지우지도 못한다 |
| `0045_group_chat_visible_from_join.sql` | 채팅은 **들어온 시점부터** 보인다. 합류 전 대화는 정책이 막는다                     |
| `0046_group_owner_actions.sql`     | 모임장이 한 일을 방에 구분해 남긴다 — 내보내기·모임장 넘기기                            |
| `0047_profile_hashtags.sql`        | 프로필 해시태그 — `profiles.hashtags` + 모양 검사 + 태그 검색 인덱스                    |
| `0048_opposite_gender_only.sql`    | 멤버가 보는 사람은 **이성만**. 열람 정책에 성별 조건 + 동성 신청 금지 트리거             |
| `0049_self_request_keeps_its_own_reason.sql` | 자기 자신에게 낸 신청은 전용 제약이 이유를 말하도록 트리거가 비켜선다        |
| `0050_oauth_login.sql`             | 주선자 인증을 소셜 로그인으로 — `oauth_accounts` 추가, 비밀번호 컬럼·시도 제한 테이블 삭제 |
| `0051_avatar_images.sql`           | 주선자 프로필 사진(`users.avatar_key`)과 모임 사진(`groups.image_key`)                 |
| `0052_users_identity_columns_readonly.sql` | 런타임 롤의 `users` UPDATE 에서 `email`·`phone` 제외 — 신원은 인증 레이어만 쓴다 |

## 테이블

| 테이블                                         | 역할                                               | 앱 롤 접근                          |
| ---------------------------------------------- | -------------------------------------------------- | ----------------------------------- |
| `groups`                                       | 모임. 이름·설명·사진(`image_key`). 가입과 별개로 만든다 | 소속 주선자 + 소속 멤버        |
| `group_admins`                                 | 모임 ↔ 주선자 (**다대다**, 모임마다 OWNER 한 명)   | 같은 모임 주선자만 조회             |
| `group_messages`                               | 모임 채팅방의 글과 사건(`system_kind`). 고칠 수 없고 사람의 글만 지워진다 | 같은 모임 주선자 중 **들어온 뒤의 것만** (쓰기는 본인 명의·사람의 글만) |
| `group_chat_prefs`                             | 주선자별 방 상태 — 읽은 위치·텔레그램 알림 여부    | 본인 것만                           |
| `users`                                        | 계정. `active_group_id` 는 주선자가 보고 있는 모임, `avatar_key` 는 프로필 사진 | 본인 + 같은 모임 관계자 |
| `profiles`                                     | 프로필. `public_code` 가 화면의 `#17`, `is_seed` 는 합성 표식 | 공개분 + 본인 + 관리자   |
| `profile_images`                               | 사진 메타데이터 (`storage_key` 만, URL 저장 안 함) | 부모 프로필을 읽을 수 있으면        |
| `match_requests`                               | 소개 신청과 상태                                   | 당사자 + 관리자                     |
| `favorites`                                    | 관심                                               | 본인만                              |
| `profile_hides`                                | 숨긴 상대. 양방향으로 목록·신청을 막는다           | **숨긴 사람만** (상대·관리자 불가)  |
| `match_intents`                                | 멤버가 낸 요청. 승인 전까지 **상대는 못 읽는다**   | 본인 + 담당 주선자                  |
| `invites`                                      | **멤버 로그인 링크** (토큰 해시만 저장)            | 관리자만                            |
| `import_sessions` / `_assets` / `_extractions` | Import 파이프라인                                  | 관리자만                            |
| `audit_logs`                                   | 감사 기록                                          | 쓰기는 인증된 누구나, 읽기는 관리자 |
| `notifications`                                | 알림 아웃박스. 트리거가 만들고 디스패처가 보낸다   | 받는 사람이 **읽기만**              |
| `telegram_connections`                         | 텔레그램 계정 ↔ 주선자 연결. `upload_group_id` 는 봇이 담을 모임 | 본인 것만            |
| `telegram_import_sessions`                     | 봇 대화 상태 (ImportSession 과 1:1)                | 관리자만                            |
| `sessions`                                     | 세션                                               | **권한 없음** (owner 커넥션 전용)   |
| `telegram_link_codes` · `telegram_webhook_events` | 봇 연결 코드(해시) · webhook 중복 판정          | **권한 없음** (owner 커넥션 전용)   |
| `group_invite_codes`                           | 모임 초대 코드(해시). 동료 주선자 합류             | **권한 없음** (owner 커넥션 전용)   |
| `oauth_accounts`                               | 주선자 신원 — 제공자(카카오·구글) + 제공자 고유 id | **권한 없음** (owner 커넥션 전용)   |

## 무결성을 DB 가 지키는 것

코드에 맡기지 않고 스키마로 고정한 규칙들이다.

| 제약                                                 | 막는 것                                       |
| ---------------------------------------------------- | --------------------------------------------- |
| `match_requests_one_active` (부분 유니크)            | 같은 방향 활성 신청 중복 — 동시 요청도 막힌다 |
| `match_requests_no_self`                             | 자기 자신에게 신청                            |
| `match_intents_one_pending_send` (부분 유니크)       | 같은 상대에게 확인 대기 요청 중복             |
| `match_intents_one_pending_answer` (부분 유니크)     | 한 신청에 수락·거절이 동시에 대기             |
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
| `telegram_connections_own` 의 WITH CHECK            | 속하지 않은 모임을 봇 업로드 대상으로 두기    |
| `group_admins_one_owner` (부분 유니크)              | 모임당 OWNER 두 명                            |
| `users.active_group_id` 의 컬럼 UPDATE 권한 회수    | 런타임 롤이 보고 있는 모임을 바꾸는 것        |
| `users` 의 컬럼 단위 UPDATE 권한 (`display_name`·`avatar_key`·`last_login_at`·`updated_at` 만) | 역할·이메일·전화번호·활성 모임을 런타임 롤이 고치는 것 |
| `notifications_dedupe_idx` (부분 유니크)            | 같은 사건으로 같은 사람에게 두 번 알림        |
| `notifications_group_pending_idx` (부분 유니크)     | 방 하나에 아직 안 보낸 채팅 알림 두 개 — 줄마다 울리는 것 |
| `group_messages_update_guard` 트리거                | 남긴 글을 고치는 것 (지우기와 계정 삭제만 통과), 시스템 메시지를 지우는 것 |
| `group_messages_write` 의 `system_kind IS NULL`     | 사람이 사건 기록을 손으로 지어내는 것          |
| `group_messages_read` 의 `app_group_chat_visible_from()` | 합류 전 대화를 뒤늦게 읽는 것 (목록·스트림·배지 모두) |
| `group_messages_body_sane` (CHECK)                  | 본문 있는 시스템 메시지 · 본문 없는 사람의 글  |
| `profiles.group_id` · `import_sessions.group_id` NOT NULL | 소속 없는 데이터 — 격리를 우회하는 구멍 |
| `profiles_hashtags_shape` · `profiles_hashtags_len` (CHECK) | `#`·공백이 섞인 태그, 11개째 태그 — 같은 태그가 둘로 갈리는 것 |

`match_requests_stamp` 트리거가 상태 전이 시각(`responded_at` · `introduced_at` · `closed_at`)을
DB 에서 채운다. 코드가 빠뜨려도 기록이 남는다.

`match_requests_notify_created` · `match_requests_notify_introduced` 트리거가 담당 주선자
(`app_profile_admins()`)에게 보낼 알림을 `notifications` 에 넣는다. 전이가 실제로 성공했을
때만 돌기 때문에 애플리케이션이 알림을 빠뜨릴 수 없다.

`match_requests_block_closed_relations` 트리거가 거절·숨김 관계의 새 신청을 막는다. 판정은
방향을 구분하지 않는다 — 한쪽만 막으면 탐색 목록에서 서로 빠지는 것과 어긋난다.
`app_discover_excluded_profile_ids()` 가 같은 관계를 목록 쿼리에 알려주고,
`app_is_rejected_between()` · `app_is_hidden_between()` 이 화면의 버튼 상태를 정한다.
두 함수는 형태가 둘이다 — 한 인자 형태는 세션 프로필과 상대를, 두 인자 형태는 두 사람을
직접 본다. 주선자가 승인하며 신청을 만드는 경로에는 세션 프로필이 없으므로 두 인자
형태를 쓴다.
숨김 판정 함수들이 `SECURITY DEFINER` 인 이유는 **누가 숨겼는지는 정책으로 가려 두고**
판정만 내보내기 위해서다.

`profile_hides_block_active_request` 트리거가 그 반대 방향을 막는다 — 활성 신청이 있는
상대는 숨기지 못한다. 두 트리거가 함께 있어야 「숨김 + 활성 신청」이 어느 순서로도
만들어지지 않는다. 그 조합은 멤버가 스스로 되돌릴 수 없는 상태다.

`group_messages_broadcast_created` · `group_messages_broadcast_deleted` 트리거가 채널
`bolsaram_group_chat` 으로 `pg_notify` 한다. **payload 에 본문이 없다** — 이 채널은
권한 판정을 거치지 않고 모든 방의 사건이 지나가므로, 「어느 방에서 무엇이 바뀌었다」만
싣고 내용은 구독자가 자기 RLS 컨텍스트로 다시 읽는다.

`app_group_chat_visible_from(group)` 이 그 방에서 볼 수 있는 가장 이른 시각을 준다 —
`group_admins.added_at` 을 밀리초로 내린 값이다(0045). 정밀도를 맞추지 않으면 자기 입장
기록이 자기 기준보다 이르다고 판정되어 빠진다(`group_messages.created_at` 은 밀리초,
`added_at` 은 마이크로초다). 목록·스트림·안 읽은 수가 모두 이 테이블을 읽으므로
애플리케이션이 아니라 **정책 한 곳**에서 자른다.

`group_admins_announce_joined` · `group_admins_announce_left` ·
`group_admins_announce_owner` · `profiles_announce_registered` ·
`match_requests_announce_created` · `match_requests_announce_introduced` 트리거가 모임의
사건을 그 방의 시스템 메시지로 남긴다(0044·0046). 퇴장 트리거는 DELETE 한 줄만 보므로
자진 탈퇴와 내보내기를 스스로 가르지 못한다 — 내보내는 경로가 트랜잭션 지역 GUC
`app.group_admin_removed_by` 에 실행한 사람을 적고 트리거가 그 값으로 종류를 정한다. 전부 `app_post_group_system_message()` 를 지나며, 방이 없는 경우
(전체공개 · 삭제 중인 모임)는 조용히 넘어간다. **문장이 아니라 사실을 저장한다** —
본문은 비우고 종류와 `payload`(공개 번호 · 주선자 이름)만 남겨 화면이 문장을 만든다.
작성자 자리에는 그 사건을 일으킨 **주선자**만 들어간다(`app_group_chat_actor()`) —
멤버가 낸 신청은 비어 있다. 주선자 방에 멤버 계정을 작성자로 박으면 이름 조인으로
멤버 이름이 새어 나간다.

`group_messages_notify` 트리거가 새 글을 알림을 켜 둔 같은 방 주선자에게 넣는다.
**시스템 메시지는 빼고** 보낸다(0044) — 신청·연결은 0017 계열이 이미 알린다. 쓴 사람은
빠지고, payload 에는 모임 이름만 싣는다 — 본문은 볼사람에서 읽는다.

`group_messages_update_guard` 트리거가 이 방의 글을 **지우는 것 외의 수정**에서 지킨다.
지울 때 본문을 빈 문자열로 만들어 DB 에도 남기지 않는다. 계정 삭제로 작성자만 비워지는
UPDATE 는 통과시킨다(0041) — 그 경로까지 막으면 주선자 계정을 지울 수 없다.

`group_admins_clear_active_group` 트리거가 모임에서 나간 주선자의 `users.active_group_id`
를 비운다. 소속이 끊겼는데 그 모임을 보고 있는 상태를 남기지 않는다.
`group_admins_clear_telegram_upload_group` 이 `telegram_connections.upload_group_id` 에
같은 일을 한다 — 나간 모임으로 봇 업로드가 계속 향하지 않게 한다.

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

`group_admins` 는 다대다다 — 한 주선자가 여러 모임에 속하고, 정책은 속한 **모든** 모임을
통과시킨다. `users.active_group_id` 는 그중 지금 화면이 보여줄 하나를 가리킬 뿐이며
**정책은 이 값을 보지 않는다.** 그래서 그 값이 무엇이든 볼 수 있는 범위는 달라지지 않고,
런타임 롤은 컬럼 UPDATE 권한이 없어 바꾸지도 못한다.

`group_admins` 에는 **SELECT 정책 하나뿐**이다. 소속을 만들고 없애고 `is_owner` 를 옮기는
것은 전부 인증 레이어(owner 커넥션)의 몫이다 — 가입·초대 코드 소비·나가기, 그리고
모임장의 넘기기·내보내기. 런타임 롤로는 INSERT 가 거부되고 UPDATE·DELETE 는 0건이
지나간다. 모임장만 할 수 있다는 판정도 애플리케이션 레이어에만 있다.

`telegram_connections.upload_group_id` 도 권한이 아니라 목적지다. 다만 이 값은 런타임 롤이
직접 바꾸므로 정책의 WITH CHECK 가 속한 모임인지 확인한다.

| 함수                                   | 판정                                                |
| -------------------------------------- | --------------------------------------------------- |
| `app_is_group_admin(uuid)`             | 그 모임의 주선자인가                                |
| `app_can_view_profile_as_admin(uuid)`  | 전체공개이거나 자기 모임인가 (읽기)                 |
| `app_can_edit_profile(uuid)`           | 자기 모임이거나, 전체공개인데 자기가 등록했는가     |
| `app_can_edit_import(uuid)`            | 위와 같은 판정을 Import 세션에                      |
| `app_current_member_group()`           | 현재 멤버가 속한 풀 (전체공개 멤버는 NULL)          |
| `app_current_member_gender()`          | 현재 멤버(대행 중이면 그 프로필)의 성별             |
| `app_profile_admins(uuid)`             | 그 프로필의 담당 주선자 집합 (알림 수신자)          |
| `app_is_rejected_between(uuid[, uuid])` | 어느 방향이든 거절 이력이 있는가                   |
| `app_is_hidden_between(uuid[, uuid])`  | 어느 방향이든 숨긴 관계인가                         |

- 익명(둘 다 NULL)은 어떤 프로필도 읽지 못한다.
- 모임에 속하지 않은 주선자는 전체공개 프로필만 보고, 고치는 것은 자기가 등록한 것뿐이다.
- 멤버는 **자기와 같은 풀** 안의 공개 프로필만 보고, 풀을 넘는 소개 신청은 만들 수 없다
  (`IS NOT DISTINCT FROM` 이라 전체공개 멤버끼리도 서로 보인다).
- 멤버가 보는 사람은 **이성뿐이다**(`gender <> app_current_member_gender()`). 동성에게는
  신청도 만들어지지 않는다 — `match_requests_require_opposite_gender` 트리거가 막는다.
  **대행 중인 주선자는 이 정책으로 걸리지 않는다** — 주선자 절로 먼저 통과하기 때문이며,
  대행의 경계는 애플리케이션 레이어(`isMemberView`)가 판정한다.
- **claim 정책은 없다.** 주인 없는 프로필을 자기 것으로 만드는 것은 해시된 초대 토큰을
  검증하는 인증 레이어(owner 커넥션)에서만 일어난다. 정책으로 열어두면 초대 없이도
  남의 프로필을 가져갈 수 있다(0013 에서 제거).
- 멤버는 공개 프로필과 자기 프로필만 읽고, 프로필을 만들거나 남의 것을 고칠 수 없다.
- 신청은 **자기 명의로만** 만들 수 있다(`requester_profile_id = app_current_profile_id()`).
  담당 주선자가 멤버의 요청을 승인하며 만드는 경로는 예외이고, 그때도 풀 경계는 지킨다.
- **신청을 옮기는 것은 그 답을 낸 사람의 담당 주선자다.** 읽기는 양쪽 담당이 함께 하지만
  수락·거절은 받은 쪽 담당, 취소는 신청자 쪽 담당만 기록한다 — 수락은 연락처 상호 공개라
  그 동의가 상대의 것이어야 한다. 종료는 목록 정리라 양쪽 누구나 한다.
- Import·초대는 관리자 전용이다.
- 텔레그램 봇 대화·계정 연결도 관리자 전용이다. webhook 은 **RLS 를 우회하지 않는다** —
  신원 확인만 owner 커넥션으로 하고, 그 뒤 모든 접근은 연결된 주선자 명의로 정책을 통과한다.
- 봇 연결 코드와 webhook 이벤트 테이블은 `sessions` 와 같은 취급이다.
  정책을 주지 않고 권한을 회수해 런타임 롤이 아예 접근하지 못한다.
- `notifications` 는 **읽기만** 열려 있고 그마저 받는 사람 본인으로 제한된다. 만드는 것은
  트리거(owner 소유 SECURITY DEFINER), 보냈다고 표시하는 것은 디스패처(owner)뿐이다 —
  정책과 권한 회수로 두 겹을 걸었다.

`tests/rls.test.ts` 43개, `tests/group-isolation.test.ts` 11개,
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
