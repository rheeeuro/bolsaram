# 볼사람 v2 구현 계획

`docs/v2/BOLSARAM_SERVICE_DESIGN_v2.md`, `BOLSARAM_MOBILE_SHARE_IMPORT_GUIDE_v2.md`,
`BOLSARAM_CODEX_BOOTSTRAP_PROMPT_v2.md` 를 기준으로 한 실행 계획이다.

## 설계 문서와 달라진 결정

설계 문서는 Supabase(PostgreSQL/Auth/Storage/RLS)를 전제하지만, 이 저장소의 고정
인프라는 로컬 컨테이너다. 사용자 확인을 거쳐 다음과 같이 대체했다.

| 설계 문서           | 이 구현                                                                          | 이유                                                                                |
| ------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Supabase PostgreSQL | 로컬 `postgres:17` (`127.0.0.1:5442`)                                            | 외부 계정·키 없이 전체 플로우를 실제로 돌려 검증하기 위해                           |
| Supabase Auth       | 자체 세션(서명 쿠키 + `sessions` 테이블), 관리자 이메일/비밀번호 · 회원 전화 OTP | 동일                                                                                |
| Supabase Storage    | 로컬 private 디렉터리 + HMAC signed URL                                          | 동일                                                                                |
| Supabase RLS        | Postgres RLS 그대로 사용                                                         | 대체하지 않았다. `bolsaram_app` 롤은 `NOBYPASSRLS` 이며 모든 접근이 정책을 통과한다 |
| OpenAI multimodal   | provider 추상화, 기본 `mock`                                                     | `OPENAI_API_KEY` 가 있으면 `AI_PROVIDER=openai` 로 전환                             |
| Expo 모바일 앱      | 이번 범위 제외. spike 계획 문서 + 웹 Import 우선                                 | 실기기 검증 없이 share 동작을 확정할 수 없다(설계문서 §15-0)                        |

기존 MariaDB(`3308`)는 v1 프로토타입용이며 `docker compose --profile legacy` 로만 뜬다.
백엔드 포트 `8010` 은 쓰지 않는다 — API 가 Next.js Route Handler 로 웹 앱(`3020`) 안에 있다.

## 단계

| 단계 | 내용                                                                         | 상태                           |
| ---- | ---------------------------------------------------------------------------- | ------------------------------ |
| 0    | Share Spike 계획 문서                                                        | 완료(문서), 실기기 검증 미실시 |
| 1    | Foundation: pnpm workspace, TS strict, lint/test, 디자인 토큰                | 완료                           |
| 2    | Schema: 마이그레이션 · 인덱스 · 제약 · RLS · synthetic seed                  | 완료                           |
| 3    | Auth/Roles: 세션, 서버 권한 검증, admin route guard                          | 완료                           |
| 4    | Storage: private 저장소 + 단기 signed URL                                    | 완료                           |
| 5    | Member UI: Discover / 필터 / 상세 / 관심 / 시그널 / 내 프로필                | 완료                           |
| 6    | Match domain: 상태 전이 중앙화, 자기 자신·중복·race 차단                     | 완료                           |
| 7    | Admin: 대시보드 / 프로필 / 신청 / 회원 / Import Inbox                        | 완료                           |
| 8    | Import API: 세션 · 다중 에셋 업로드 · 원문 · 분석 · 검토 · idempotent commit | 완료                           |
| 9    | AI extraction: Zod single source, 추측 금지, confidence, mock 가능           | 완료                           |
| 10   | Mobile Share                                                                 | 미착수·후순위 (텔레그램으로 대체) |
| 11   | Invite/Claim: 만료·해시 토큰, replay 방지                                    | 완료                           |
| 12   | Tests: 필터 · 상태 전이 · 권한 · 정규화 · 검증 · idempotency                 | 완료                           |
| 13   | 텔레그램 Import: webhook · 계정 연결 · 대화 상태 · 사진/글 수집 · Inbox 연동  | 완료(코드), 실기기 검증 미실시 |

## 실기기에서 따로 확인해야 하는 항목

`docs/share-spike-plan.md` 참고. 코드만으로 확정할 수 없다.

## 검증 상태

`pnpm verify` (typecheck + lint + test) 통과. 테스트 171개:

| 파일                                 | 내용                                                    | 개수 |
| ------------------------------------ | ------------------------------------------------------- | ---- |
| `tests/match-transitions.test.ts`    | 상태 기계 · 행위자 권한 · 중복/자기 자신 차단           | 11   |
| `tests/visibility.test.ts`           | 단계적 정보 공개 · 노출 규칙                            | 10   |
| `tests/filters.test.ts`              | 필터 → SQL · 파라미터 바인딩 · 커서                     | 12   |
| `tests/import-normalization.test.ts` | 원문 정규화 · Import 상태 기계 · commit 게이트          | 23   |
| `tests/extraction.test.ts`           | 추출 스키마 검증 · strict JSON Schema · mock 프로바이더 | 15   |
| `tests/rls.test.ts`                  | 실제 DB 에 대한 RLS 정책 강제                           | 22   |
| `tests/import-commit.test.ts`        | 분석 · commit 멱등성 · 동시 호출                        | 8    |

수동으로 확인한 것(로컬 서버, 실제 DB):

- 미인증 요청은 API 401, 페이지는 `/login` 리다이렉트. 회원의 `/admin` 접근은 `/discover` 리다이렉트.
- 관리자/회원 로그인, OTP 오입력·재발송 제한.
- Discover 필터 전 항목, 한국어 자유 검색.
- `신청 → 수락 → 연결` 전 구간과 각 단계의 정보 공개 범위. 제3자에게는 끝까지 비공개.
- Import: 세션 생성 → signed upload(미인증 401 / 서명 위조 403) → mock 추출 → 검토 → commit.
- 같은 세션 commit 2회 호출 시 동일 프로필 반환(`reused: true`).
- 검토가 남은 상태에서 공개 commit 거부.
- 초대 발급 → claim → 재사용 거부. 평문 토큰은 DB에 없음.
- signed URL: 유효 200 / 비로그인 401 / 변조 403 / 만료 410 / 경로 탈출 403, `cache-control: private, no-store`.

브라우저 스크린샷은 찍지 못했습니다 — 이 호스트에 Chromium 실행에 필요한 시스템 라이브러리(`libatk-1.0`)가
없습니다. 대신 각 화면의 렌더링된 HTML에서 핵심 요소를 확인했습니다.

## 운영 (2026-09-07 추가)

PM2 로 상시 기동한다. 정의는 `ecosystem.config.cjs`.

| 앱                 | 역할                                                       | 스케줄     |
| ------------------ | ---------------------------------------------------------- | ---------- |
| `bolsaram-web`     | 웹 + API (3020)                                            | 상시       |
| `bolsaram-cleanup` | 만료 세션·OTP·초대·감사 로그 정리, 방치된 Import 원본 삭제 | 매일 04:10 |

`APP_ENV` 를 `NODE_ENV` 와 분리했다. PM2 로 띄우면 `NODE_ENV=production` 이지만 이 인스턴스는
아직 실제 사용자를 받지 않는 스테이징이라, 두 축을 섞으면 "빌드 최적화를 켜려면 회원 로그인을
포기해야 하는" 상황이 된다. `APP_ENV=staging` 에서는 OTP 를 화면에 띄워 회원 흐름을 확인할 수
있고, `production` 으로 올리면 서버가 그 조합을 거부한다.

배포 스크립트 이름을 `deploy` → `deploy:web` 으로 바꿨다(2026-09-07). pnpm 9 에 내장 `deploy`
명령이 있어 `pnpm deploy` 가 스크립트 대신 그쪽으로 잡히고 `ERR_PNPM_NOTHING_TO_DEPLOY` 로
끝났다. `pnpm run deploy` 로 우회할 수는 있지만, 짧은 형태를 습관적으로 치면 계속 걸리므로
이름 자체를 겹치지 않게 했다. `pm2:*`·`db:*` 와 같은 접두 규칙에도 맞는다.
턴 종료 훅(`deploy-on-stop.sh`)은 `pnpm build` 와 `pm2 restart` 를 직접 부르므로 영향이 없다.

## 에이전트 하네스 (2026-09-07 추가)

`../jongalab` 의 구조를 참고해 `.agent-config/` 단일 원본 + `sync.py` 생성 방식을 도입했다.
훅이 편집마다 타입체크·RLS 검사를 돌리고, 턴 종료 시 빌드 후 PM2 를 재시작한다.
민감 파일(비밀·private 스토리지·적용된 마이그레이션·생성 설정)은 Edit 도구와 셸 양쪽에서 막는다.
판정 케이스 23개는 `pnpm agents:test` 로 검증한다.

## 사용자 가이드 (2026-09-07 추가)

`docs/guide/` 에 회원·주선자용 문서를 두고, 구현과 어긋나면 `tests/docs-guide.test.ts` 가
실패하게 했다. 문서 동기화를 사람 기억에 맡기지 않기 위해서다.

검사 대상은 바뀌면 사용자 경험이 달라지는 사실뿐이다 — 안내하는 화면의 존재, 정책 숫자,
상태 라벨, 보안 약속. 문구·표현은 검사하지 않는다(문서를 다듬을 때마다 깨지면 쓸모가 없다).
드리프트를 실제로 잡는지 세 가지 방식(정책 숫자 변경·상태 라벨 변경·없는 화면 안내)으로 확인했다.

`track-changes.sh` 는 회원·관리자 화면, 인증, 상태 enum, 업로드 제한, PM2 스케줄을 건드리면
가이드 동기화를 상기시킨다.

## 디렉터리 README (2026-09-07 추가)

`../jongalab` 방식대로 주요 디렉터리마다 "현재 구조" README 를 두고, 코드와 어긋나면
`tests/docs-readme.test.ts` 가 실패하게 했다.

검사는 양방향이다 — README 가 **없는 파일을 설명**하거나(죽은 참조), **있는 파일을 빠뜨리면**
(누락) 잡힌다. 라우트처럼 파일이 많고 규칙적인 곳은 디렉터리 단위로만 본다. 파일마다 문서를
고치게 만들면 문서가 방치되기 때문이다.

문서 계층을 셋으로 나눴다 — 코드 주석(지금 하는 일과 이유), 디렉터리 README(현재 구조),
이 문서(이력과 결정 배경). README 에 이력을 쓰지 않는다.

`track-changes.sh` 는 파일 경로로 어느 README 를 봐야 하는지 지목한다.

## 카카오 챗봇 Import 설계 변경 폐기 (2026-09-07)

`docs/v2/BOLSARAM_ARCHITECTURE_CHANGE_CHATBOT_v1.md` 는 Import 1차 채널을 모바일 Share
에서 카카오 챗봇으로 바꾸자는 설계 변경이었다. **채택하지 않았다.**

폐기 이유는 카카오 공식 스펙이다. 카카오 i 오픈빌더 스킬 요청의 `userRequest` 에는
`block` · `user` · `utterance` · `params` · `lang` · `timezone` 만 있고 사용자가 보낸
이미지·미디어·첨부파일을 전달하는 필드가 없다. 즉 그 문서 §4.1 의 핵심 흐름인
「사진 여러 장 전송 → Chatbot Webhook → ImportSession」이 오픈빌더로는 성립하지 않는다.
사용자 전송 이미지를 webhook 으로 받는 카카오 제품은 상담톡이며 파트너사 연동과 별도
계약이 필요하다 — 자체 스킬 서버만으로는 불가능하다.

따라서 Import 채널은 기존 구현을 유지한다: 관리자 웹 직접 업로드 + 원문 붙여넣기 +
AI 추출 + 관리자 검토. `import_source` enum 에 `KAKAO_CHATBOT` 을 추가하지 않았고
`chatbot_conversations` · `ProcessedExternalEvent` 같은 테이블도 만들지 않았다.
모바일 Share 의 우선순위도 내리지 않는다(원래 §10 단계로 미착수 상태다).

이 판단이 뒤집히는 조건은 하나다 — 상담톡 파트너 연동 계약이 생기고 실제 payload 와
이미지 URL lifetime 을 PoC 로 확인한 경우. 그때는 기존 Import 도메인을 그대로 두고
입력 Adapter 만 추가하는 그 문서의 방향(§7·§8)이 여전히 맞다.

## 텔레그램 Import 채널 (2026-09-07 추가)

`docs/v2/BOLSARAM_ARCHITECTURE_CHANGE_TELEGRAM_v1.md` 를 구현했다. Import 1차 채널을
모바일 OS Share 에서 텔레그램 봇으로 옮기는 설계 변경이다.

같은 날 폐기한 카카오 챗봇안(위 절)과 달리 이건 **공식 스펙으로 구현 가능하다.**
Bot API 는 사진을 `photo`(해상도별 변형 배열) 또는 `document` 로 webhook 에 실어주고,
`getFile` → `https://api.telegram.org/file/bot<token>/<file_path>` 로 내려받을 수 있다.
`setWebhook` 의 `secret_token` 이 요청 헤더 `X-Telegram-Bot-Api-Secret-Token` 으로
되돌아와 발신자 확인 수단이 된다. 파일 상한은 20MB, 다운로드 링크는 최소 1시간 유효하다.

### 설계 문서와 달라진 결정

| 설계 문서                          | 이 구현                                   | 이유                                                                                                              |
| ---------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `packages/integrations/telegram/`  | `apps/web/src/server/telegram/`           | private 스토리지·Import 서비스가 `server-only` 로 웹 앱 안에 있다. 패키지로 빼면 그것들을 옮기거나 복제해야 한다  |
| `ImportSession.createdBy` nullable | NOT NULL 유지, 연결된 주선자를 넣는다     | 봇 신원을 ADMIN 계정에 매핑하므로 nullable 이 필요 없다. 관리자 화면에서 누가 가져왔는지 보이고 감사 기록도 남는다 |
| album debounce/buffering           | 하지 않는다                               | 사진을 묶는 것은 **대화 세션**이지 앨범이 아니다. `media_group_id` 는 같은 앨범에 안내를 한 번만 보내는 데만 쓴다  |
| `TelegramWebhookEvent.payloadHash` | 두지 않는다                               | `update_id` 가 봇 단위로 유일해 그것만으로 중복이 걸린다. §15 의 「payload 장기 저장 금지」와도 맞는다             |
| `source` 에서 `KAKAO_SHARE` 제거   | 남겨둔다                                  | 설계 문서 §8 이 그렇게 하라고 했고, 삭제 마이그레이션은 만들지 않는다                                              |
| `/start /new /cancel /status`      | `/analyze` · `/help` 추가                 | 사진 설명만으로 분석을 시작할 방법이 없으면 caption 경로가 막힌다                                                 |

### webhook 이 RLS 를 우회하지 않게 만든 방법

webhook 에는 세션 쿠키가 없다. 그렇다고 owner 커넥션으로 Import 를 쓰면
「service-role 을 인증 레이어 밖에서 쓰지 않는다」가 깨진다. 그래서 둘로 쪼갰다.

```
owner 커넥션 (인증 레이어, server/auth/telegram.ts)
  update_id 선점 · 연결 코드 소비 · 텔레그램 계정 → 주선자 신원 확인
        ↓ 신원 확정
withRls(주선자) — 그 뒤 전부. 일반 관리자 요청과 완전히 같다.
```

`telegram_link_codes` · `telegram_webhook_events` 는 `sessions`·`login_codes` 와 같은
취급이다 — 정책을 주지 않고 `REVOKE` 로 런타임 롤 권한을 회수했다. 0001 의
`ALTER DEFAULT PRIVILEGES` 가 새 테이블에 자동으로 권한을 주므로 명시적 회수가 필요했다.
`tests/telegram-import.test.ts` 의 「런타임 롤은 …접근할 수 없다」가 이걸 지킨다.

### at-most-once 를 골랐다

`update_id` 선점을 **처리 전에** 한다. 처리 중 실패하면 그 update 는 다시 오지 않는다
(행은 `processed_at IS NULL` 로 남아 조사에 쓴다). 반대로 처리 후에 선점하면 재전송이
사진을 두 번 저장한다.

의도적으로 이쪽을 골랐다 — 사진이 중복되면 프로필이 조용히 망가지는데, 유실되면 봇이
운영자에게 실패를 알리고 다시 보내면 된다. 설계 문서 §18 이 요구하는 것도 중복 방지다.

연결 코드는 `INVITE_TOKEN_PEPPER` 를 재사용하되 `telegram-link:` 접두어로 용도를 갈랐다.
새 필수 시크릿을 늘리지 않으면서 한쪽 해시를 다른 쪽에 쓸 수 없게 한다.

### 앨범 사진의 순서

앨범은 여러 webhook 으로 거의 동시에 도착한다. `MAX(sort_order) + 1` 로 번호를 매기면
같은 번호를 잡아 `UNIQUE (import_session_id, sort_order)` 에 걸리거나 서로를 덮어쓴다.
`appendUploadedAsset` 이 세션 행을 `FOR UPDATE` 로 먼저 잠가 직렬화한다 — 재시도 대신
도착 순서를 그대로 보존하는 쪽을 골랐다. 잠금을 빼면
`tests/telegram-import.test.ts` 「같은 앨범이 동시에 들어와도」가 실패한다(확인함).

### 문서 동기화

`tests/docs-guide.test.ts` 에 봇 정책 숫자(연결 코드 15분 · 사진 20MB · 대화 만료 24시간)와
봇 명령 목록, 「봇도 검토를 거친다」·「주선자 전용 통로」 약속을 고정했다. 같은 테스트의
경로 검사가 봇 명령을 앱 경로로 오인하므로 `TELEGRAM_COMMANDS` 를 코드에서 가져와 제외했다.

### 남은 일

**실기기 검증을 하지 않았다.** @BotFather 토큰이 없어 실제 Bot API 를 한 번도 호출하지
못했다. 아래를 사람이 해야 한다.

1. @BotFather 로 봇 생성 → 토큰 확보
2. `.env` 에 `TELEGRAM_ENABLED=true` · `TELEGRAM_BOT_TOKEN` ·
   `TELEGRAM_WEBHOOK_SECRET`(`openssl rand -hex 32`) 추가
3. `pnpm deploy:web` 으로 재시작
4. 공개 HTTPS 주소로 `setWebhook` 등록 —
   `https://api.telegram.org/bot<token>/setWebhook?url=<origin>/api/integrations/telegram/webhook&secret_token=<secret>`
   (`APP_ORIGIN` 이 `127.0.0.1` 이라 지금은 텔레그램이 도달할 수 없다. 터널이나 도메인이 필요하다)
5. 관리자 화면 → Import Inbox → 텔레그램 연결 → `/start <코드>`
6. 사진 여러 장 → 프로필 글 → Inbox 에 올라오는지 확인

검증 전에는 Bot API 응답 형태를 추측으로 고치지 않는다. 특히 확인이 필요한 것:
앨범이 실제로 몇 개 update 로 쪼개지는지, HEIC 를 보냈을 때 `photo` 의 mime 이
정말 JPEG 로 바뀌는지, webhook 재전송 간격.
