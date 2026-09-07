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
| 13   | 텔레그램 Import: webhook · 계정 연결 · 대화 상태 · 사진/글 수집 · Inbox 연동  | 완료 (실기기 검증 포함)        |

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

### Node fetch 가 텔레그램에만 실패했던 것 (2026-09-07)

토큰을 넣고 처음 실제 호출을 했을 때 `getBotUsername()` 이 `fetch failed / ETIMEDOUT`
으로 실패했다. 같은 호스트에서 `curl` 은 정상이고, Node `fetch` 는 GitHub·npm 에는
붙는데 `api.telegram.org` 에만 실패했다.

원인은 IPv6 가 아니라 **연결 지연**이었다. Node 의 Happy Eyeballs 는 주소 하나당
`autoSelectFamilyAttemptTimeout`(기본 **250ms**)만 기다리고 다음 주소로 넘어간다.
`api.telegram.org`(암스테르담) 은 이 호스트에서 TCP 연결에 **260~266ms** 걸려 시도가
완료 직전에 취소된다. GitHub 는 6ms(로컬 엣지)라 걸리지 않았다.

`startup-node.ts` 에서 이 값을 2초로 올렸다. 주소 선택 방식은 건드리지 않았다 —
`--dns-result-order=ipv4first` 는 효과가 없었고(문제가 주소 선택이 아니므로),
IPv4 를 강제하는 대신 느린 연결을 허용하는 쪽이 원인에 맞는 처방이다.
OpenAI 처럼 해외 프로바이더 호출 전부가 같은 제한에 걸리므로 함께 해결된다.

이 과정에서 `instrumentation.ts` 를 런타임별로 갈랐다(`startup-node.ts`). Edge 런타임에서도
평가되는 파일에서 `node:net` 을 직접 import 하면 번들러가 경고한다 — Next 문서
「Specifying the runtime」이 안내하는 분리 방식을 따랐다.

`/api/admin/telegram` 이 `getBotUsername()` 실패를 `.catch(() => null)` 로 조용히
삼키고 있어서 원인을 찾을 수 없었다. 이유를 로그에 남기도록 고쳤다 — 토큰 오설정을
말없이 넘기면 딥링크만 사라진 채로 아무 단서가 없다.

### 남은 일

봇(`@bolsaram_bot`)과 `.env` 설정은 끝났고 여기까지 실제로 확인했다.

- `getMe` 로 토큰 유효성 확인, 관리자 화면의 연결 코드 발급이 실제 Bot API 를 거쳐
  `https://t.me/bolsaram_bot?start=<코드>` 딥링크를 만든다
- webhook: 채널 켜짐(404 → 401), 시크릿 없음·틀림 모두 401, 맞는 시크릿은 200,
  같은 `update_id` 재전송은 DB 에 행 하나만 남고 무시, 잘못된 JSON 도 200
- 로그에 프로필 원문·토큰이 남지 않음

**남은 것은 텔레그램이 우리 서버에 도달하는 구간이다.** 아래를 사람이 해야 한다.

1. 공개 HTTPS 주소 확보 — 현재 `APP_ORIGIN` 이 `127.0.0.1` 이라 텔레그램이 도달할 수 없다
2. `APP_ORIGIN` 을 그 주소로 바꾸고 `pnpm deploy:web`
3. `setWebhook` 등록 —
   `https://api.telegram.org/bot<token>/setWebhook?url=<origin>/api/integrations/telegram/webhook&secret_token=<secret>`
   (`<secret>` 은 `.env` 의 `TELEGRAM_WEBHOOK_SECRET` 값)
4. 관리자 화면 → Import Inbox → 텔레그램 연결 → 딥링크 또는 `/start <코드>`
5. 사진 여러 장 → 프로필 글 → Inbox 에 올라오는지 확인

### 실기기 검증 결과 (2026-09-07)

`bolsaram.rheeeuro.com` 에 webhook 을 등록하고 실제 봇으로 끝까지 돌렸다.

동작한 것 — 계정 연결(`/start <코드>`), 사진 4장이 **하나의 ImportSession** 으로 묶임
(order 0~3, 전부 image/jpeg, private 저장소에 4/4 복사됨), 프로필 글 수신,
AI 분석 자동 실행, `REVIEW_REQUIRED` 로 정지(자동 게시 안 됨), Inbox 에 `source=TELEGRAM`,
webhook update 전건 처리(미처리 0).

**가정이 틀린 것 — 앨범 식별자가 오지 않는다.**

실제 운영 경로는 「카카오톡에서 여러 장 선택 → 공유하기 → 텔레그램 봇」이다.
이 경로에서 텔레그램은 **앨범이 아니라 개별 메시지로** 사진을 하나씩 전달한다 —
4장 전부 `media_group_id` 가 없었다. 즉 `media_group_id` 로 안내를 억제하는 원래
설계는 실제 채널에서 한 번도 발동하지 않고, 사진 장수만큼 안내가 나갔다.

`shouldAnnounceMedia` 를 "이미 받은 장수가 0일 때만"으로 바꿨다. 첫 장에서 다음 행동만
알려주고, **총 장수는 글을 받을 때 정확한 값으로 한 번** 알려준다. 중간 확인은 `/status`.
타이머·버퍼링을 쓰지 않으므로 프로세스가 재시작돼도 안전하다.

한편 **사진을 묶는 주체를 앨범이 아니라 대화 세션으로 둔 결정은 이 실측으로 검증됐다.**
설계 문서 §5.2 가 권한 앨범 debounce 를 따랐다면 이 경로에서 프로필이 4개로 쪼개졌다.

수정 후 재검증(사진 3장 + 글): 안내 말풍선 **1건**(장수만큼 나오지 않음), 글 응답의
장수 **정확**(3장), 분석 완료 안내까지 도달. 사용자가 봇 대화창에서 확인했다.
검토 버튼 URL 은 텔레그램 검증을 통과한다(`chat not found` 만 반환 —
`BUTTON_URL_INVALID` 아님). 봇이 무엇으로 해석하고 무엇을 답했는지는
`텔레그램 수신: …` / `텔레그램 응답: …` 로그로 남긴다(내용은 남기지 않는다).

**§19 완료 기준 1~8 을 실측으로 충족했다.** 9(만료 정리)는 cleanup 단계로,
10(기존 기능 회귀 없음)은 `pnpm verify` 로, 11(Mobile Share 코드 보존)은
애초에 미착수라 해당 없음.

### 실제 프로바이더 전환 결과 (2026-09-07)

`AI_PROVIDER=openai` · `OPENAI_MODEL=gpt-5.6-luna` 로 바꾸고 같은 세션(사진 3장 + 원문)을
재분석해 mock 과 대조했다.

| 프로바이더      | 채운 필드 | 비고                                  |
| --------------- | --------- | ------------------------------------- |
| `mock/3img`     | 7/16      | 규칙 기반                             |
| `gpt-5.6-luna`  | **11/16** | 신뢰도 90~99%, 값도 타당              |

`jobTitle`→`jobCategory` 매핑(계리사 → FINANCE), 지역 정규화(→ SEOUL), MBTI·흡연·종교
열거형 변환이 전부 스키마에 맞게 들어왔다. strict JSON Schema + Zod 재검증 경로가
실모델에서도 그대로 동작한다.

**주목할 것 — 필수 필드 `gender` 가 비었다.** 모델이 남긴 메모가 이유를 밝힌다:
「성별은 원문에 명시되어 있지 않아 판단하지 않았습니다.」 사진이 3장 있었지만
추론하지 않았다. `SYSTEM_PROMPT` 의 「명시되지 않은 정보 추측 금지」를 지킨 결과이고,
그래서 `assertCommittable` 이 게시를 막는다(설계 의도대로).

다만 운영상 이건 **매번 손이 가는 지점**이다. 카카오톡 프로필 글에 성별이 적혀 있는
경우가 드물기 때문이다. 검토 화면에서 1클릭으로 고르는 방식을 유지한다 —
사진에서 읽게 하는 방안은 아래 결정으로 아예 불가능해졌다.

### 사진을 모델에 보내지 않는다 (2026-09-07 결정)

프로필은 **항상 카카오톡에서 복사한 텍스트로 들어온다**(운영 확인). 스크린샷으로 오는
경우는 없다. 그래서 추출 입력에서 이미지를 제거했다 — `ExtractionInput` 에 이미지
필드 자체가 없고, `openai.ts` 의 `ContentPart` 도 텍스트만 표현한다. 조건부로 두면
언젠가 조건이 뒤집히므로 타입에서 막았다.

**실측으로 확인한 것 — 사진은 기여가 없었다.** 같은 세션(사진 3장 + 원문 81자)을
사진을 보낸 채로 한 번, 보내지 않고 한 번 분석했다.

| 실행                | 채운 필드 | 필드 목록                        |
| ------------------- | --------- | -------------------------------- |
| 사진 3장 함께 전송  | 11/16     | birthYear, height, hobbies, idealTypeText, jobCategory, jobTitle, mbti, religion, residenceRegion, smoking, workplaceRegion |
| 사진 미전송         | 11/16     | **동일**                         |

토큰 실측으로는 `detail:"low"` 도 이미지 크기에 따라 늘어난다 — 320×400 은 장당 156,
1200×1600 은 230 토큰이다(고정 비용이라는 통념과 다르다). 실제 사진은 후자에 가까워
4장이면 600~900 토큰이며, 원문 81자는 수십 토큰이다. 즉 **입력의 대부분이 아무것도
기여하지 않는 사진이었다.**

비용보다 중요한 것은 개인정보 경로다. 설계 변경 문서 §15 의 「장기적으로 개인정보
경로를 줄인다」를 여기서 실행했다 — 실제 인물 사진이 외부 모델로 나가지 않는다.
사진은 볼사람 private 스토리지에만 남아 프로필 사진으로 쓰인다.

딸려온 변경:

- `analyzeSession` 이 사진을 디스크에서 읽지 않는다(`readAsset`·`MAX_ANALYZE_IMAGES` 제거).
  그래서 **원문이 없으면 분석을 거부한다** — 사진만 있는 세션은 분석해도 전부 null 이다.
- 봇의 `/analyze` 도 원문이 있을 때만 동작한다.
- mock 프로바이더의 model 문자열이 `mock/3img` → `mock` 으로 바뀌었다.
- 가이드의 「AI 분석에는 앞쪽 6장까지」 정책이 사라졌다. 대신 「사진은 AI 에 보내지
  않는다」를 명시하고, `docs-guide.test.ts` 가 `ExtractionInput` 에 이미지 필드가
  없는지까지 검사한다.

아직 확인하지 않은 것: 텔레그램 **안에서** 앨범으로 보낼 때의 `media_group_id`
(안내 규칙이 더 이상 그 값에 의존하지 않으므로 동작에 영향 없음), HEIC 전송 시 mime,
webhook 재전송 간격, 20MB 초과 파일의 실패 형태.

## SMS 발송 계층 (2026-09-07 추가)

`apps/web/src/server/auth/login.ts` 의 마지막 TODO 를 정리했다. 코드가 없어서 막혀 있던
것이 아니라 **구조가 없어서** 막혀 있었다 — 발송 실패·미연동 상태가 `throw` 하나로
표현돼 있었고, 운영 배포로 가려면 인증 경로를 손봐야 했다.

AI 프로바이더와 같은 방식으로 추상화했다.

```
server/sms/
├── types.ts    SmsSender 인터페이스
├── console.ts  개발용 — 서버 로그에만 남긴다
└── index.ts    SMS_PROVIDER 로 선택
```

`SmsSender` 에 `delivers` 를 둔 것이 핵심이다. "보냈다"와 "사용자 휴대폰에 도착한다"는
다른 사실인데, 이걸 구분하지 않으면 콘솔 sender 가 운영에 올라가도 화면은 "인증번호를
보냈습니다"라고 말한다. 이제 `issueLoginCode` 가 `delivered` 를 함께 돌려주고,
로그인 화면은 도착하지 않는 경로일 때 주선자에게 문의하라고 안내한다.

**실제 업체 어댑터는 넣지 않았다.** 국내 발신번호 사전등록과 계약이 필요하고, 검증하지
않은 외부 API 를 추측으로 구현하지 않는다(카카오·텔레그램에서 같은 규칙을 적용했다).
업체가 정해지면 `SmsSender` 구현 한 파일과 `SMS_PROVIDER` 값 하나를 추가하면 된다.

`APP_ENV=production` + `SMS_PROVIDER=console` 조합은 기동을 막는다 — 문자가 도착하지
않는 배포에서는 회원이 로그인할 방법이 없으므로 조용히 깨지게 두지 않는다.

### 「기동을 거부한다」는 표현을 고쳤다

이 가드를 실제로 걸어보니 **프로세스가 죽지 않는다.** `instrumentation` 훅에서 던지면
Next 는 `Failed to prepare server` 를 남기고도 포트를 열고, 이후 **모든 요청이 500** 이
된다. 아무것도 서비스하지 않으므로 안전 목적은 달성되지만, `pm2 status` 에는 `online`
으로 보이므로 설정을 바꾼 뒤에는 상태가 아니라 기동 로그를 봐야 한다.
기존 `DEV_EXPOSE_OTP` 가드도 같은 방식이었고, 문서가 "기동을 거부한다"고 적어둔 것은
정확하지 않았다. `.ai-harness/project.md` 와 `env.ts` 주석을 실제 동작으로 고쳤다.

## 관리자 로그인 시도 제한 (2026-09-07 추가)

회원 OTP 에는 시도 제한(`login_codes.attempts`, 5회)이 있었지만 **관리자 비밀번호에는
아무 제한이 없었다.** 실측으로 확인했다 — 공개 도메인(`bolsaram.rheeeuro.com`)에
틀린 비밀번호를 10회 연속 보내도 전부 403 이고 차단이 없었다. 미들웨어도 없다.

실패를 행으로 남기고 "최근 15분 안의 실패 5회"로 판정한다(`admin_login_failures`).
카운터 컬럼 하나를 두는 대신 행으로 남긴 이유는 둘이다.

- 창이 지나면 자연히 풀려서 **영구 락아웃이 없다.** 주선자가 여러 명이 될 예정이라
  특정 계정을 무기한 잠글 수 있게 만들면 안 된다.
- 주선자가 공격 흔적을 볼 수 있다. 정리 작업이 14일 뒤 지운다.

판정은 **이메일 문자열 기준**이다. 존재하지 않는 이메일로 온 시도도 같이 세야
계정 존재 여부가 응답으로 드러나지 않는다. 비밀번호 검증(scrypt, N=16384)보다
앞에서 끊어 비싼 연산을 아낀다. 성공하면 창을 비운다 — 본인이 오타 몇 번 낸 뒤
맞췄으면 제한이 남지 않아야 한다.

IP 기준 제한은 넣지 않았다. cloudflared 뒤라 클라이언트 IP 를 헤더로 받아야 하고
그 헤더는 위조 가능하다 — 신뢰 경계를 정하지 않은 채 IP 로 판정하면 오히려
우회 수단이 된다. 필요해지면 프록시 신뢰 설정과 함께 추가한다.

### 남은 위험 — 시드 비밀번호

**시도 제한은 이미 알려진 비밀번호를 막지 못한다.** 확인 시점에 공개 도메인에서
시드 비밀번호(`bolsaram-admin`, 이 저장소에 문서화된 값)로 관리자 로그인이 되었다.
그 계정으로 전체 회원의 이름·연락처·프로필 원문·사진에 접근할 수 있다.
**비밀번호 교체가 시도 제한보다 우선이며, 자격 증명이라 사용자가 결정할 사항이다.**

### 함께 드러난 빈 자리 — 주선자 계정 추가 경로

주선자 계정을 만드는 경로가 `packages/db/src/cli/seed.ts` 의 INSERT 하나뿐이다.
회원가입 화면도, 관리자 초대 기능도 없다. 주선자가 여러 명이 될 예정이므로
SQL 을 직접 만지지 않고 추가할 방법이 필요하다. 아직 만들지 않았다.

## 모임(테넌트) 격리와 주선자 가입 (2026-09-07 추가)

「주선자를 위한 서비스니 주선자 가입을 열자」는 결정에서 출발했다. 그런데 당시 권한
모델은 그걸 견딜 수 없었다 — 관리자 정책이 전부 `app_is_admin()` 하나로만 판정해서
**ADMIN 계정 하나만 만들면 전체 회원의 이름·연락처·사진에 접근**할 수 있었다.
자유 가입을 그 위에 얹으면 누구나 가입해서 남의 회원 정보를 보게 된다.

그래서 순서를 잡았다 — **격리를 먼저 완성하고 가입을 나중에 붙였다.** 반대로 하면
그 사이에 구멍이 열린다.

### 정한 것 (사용자 결정)

| 축                    | 결정                                       |
| --------------------- | ------------------------------------------ |
| 회원 풀              | **모임 안에서만** — 각 모임이 닫힌 세계    |
| 모임당 주선자        | **여러 명** (`group_admins`, OWNER 한 명)  |
| 가입 인증            | 이메일 + 비밀번호                          |
| 가입 개방            | 자유 (초대 불필요)                         |

모임 안에서만 보이게 한 이유는 「주선자가 검증한 사람만」이라는 제품 원칙과 맞고,
모임을 넘는 연결을 누가 책임지느냐는 문제가 생기지 않기 때문이다.

### 구현 (`0010_groups.sql`)

`groups` · `group_admins` 를 넣고 `profiles.group_id` · `import_sessions.group_id` 를
NOT NULL 로 조였다. 기존 데이터는 「기본 모임」으로 이관했다(주선자 1명·프로필 26건).

판정은 GUC 를 새로 만들지 않고 **SECURITY DEFINER 함수가 `group_admins` 를 직접
조회**한다 — 애플리케이션이 자기 그룹을 스스로 주장할 수 없게 하려는 것이다.

| 함수                          | 판정                               |
| ----------------------------- | ---------------------------------- |
| `app_is_group_admin(uuid)`    | 현재 사용자가 그 모임의 주선자인가 |
| `app_current_member_group()`  | 현재 회원이 속한 모임              |
| `app_can_admin_profile(uuid)` | 그 프로필 모임의 주선자인가        |

정책 15개를 다시 썼다. 함께 좁힌 것 — 회원 Discover(자기 모임만), 모임을 넘는 소개
신청(DB 차단), 텔레그램 연결(주선자 개인 것, 같은 모임에도 비공개), `users` 조회
(관리자가 남의 계정을 임의로 못 봄), `audit_logs`(본인 기록만).

### 가입 (`server/auth/signup.ts`)

계정과 모임을 **한 트랜잭션으로** 만든다. 계정만 생기고 모임이 없으면 로그인은 되는데
아무것도 못 하는 상태가 남는다. 이메일 중복으로 실패하면 모임도 만들어지지 않는지
테스트로 고정했다.

가입 비밀번호는 10자 이상이다(로그인은 기존 계정을 받아야 하므로 8 유지). 이 계정
하나로 모임 전체 회원의 개인정보에 접근하므로 새 계정에는 더 강한 기준을 적용했다.

모임에서 제거된 주선자를 위해 `POST /api/admin/groups` 를 두었다. 관리자 대시보드가
모임이 없으면 KPI 대신 「모임 만들기」 안내를 보여준다 — RLS 가 전부 막아 0 으로만
보이는 화면 대신 이유를 알려준다.

### 이 과정에서 잡은 버그

`commitSession` 이 프로필을 만들 때 `group_id` 를 넣지 않아 **등록 자체가 깨졌다**
(NOT NULL 위반). 커밋하는 주선자의 모임이 아니라 **Import 세션의 모임**을 쓰도록 했다 —
세션을 볼 수 있다는 것 자체가 RLS 로 그 모임 주선자임을 뜻하고, 여러 모임에 속한
주선자가 엉뚱한 모임에 등록하는 일을 막는다.

`tests/admin-login.test.ts` 에 실행 간 간섭이 있었다. 존재하지 않는 이메일로 쌓은
실패 기록이 남아 다음 실행을 RATE_LIMITED 로 만들었다. TAG 기반 고유 주소로 바꿨다.

### 검증

`tests/group-isolation.test.ts` 11개와 `tests/admin-signup.test.ts` 7개를 추가했다.
전부 "안 되는 것"을 검사한다 — 남의 모임 읽기·쓰기·초대·Import, 모임을 넘는 신청,
그리고 **가입만으로는 아무것도 볼 수 없다**. 기존 `rls.test.ts` 22개도 그대로 통과한다.

실제로 띄워 확인했다 — 방금 가입한 계정에게 기존 모임의 Import 4건이 보이지 않고,
기존 주선자에게는 그대로 4건이 보인다.

### 아직 안 한 것

**동료 주선자 초대.** 지금은 각자 가입하면 각자 모임이 생겨서 같은 모임에서 함께
일할 방법이 없다. 텔레그램 연결 코드와 같은 방식(해시 저장·짧은 만료·1회용)으로
모임 초대 코드를 만들고, 가입 시 코드가 있으면 새 모임을 만들지 않고 그 모임에
합류하게 하는 것이 다음 단계다.
