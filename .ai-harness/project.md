# AI 하네스: 볼사람

이 저장소는 Codex와 Claude Code가 함께 사용하는 프로젝트입니다. 두 도구 모두 코드를 변경하기 전에 이 파일의 기준을 따릅니다.

## 제품

볼사람(Bolsaram) — 주선자가 검증해 등록한 사람만 참여하는 비공개 소개팅 서비스.

- 회원 흐름: `프로필 탐색/필터 → 상세 → 마음 보내기 → 상대 수락 → 주선자 연결`
- **소속 여부가 곧 공개 여부입니다.** 주선자 가입은 열려 있고, 가입하면 **모임 없이**
  시작합니다. `profiles.group_id IS NULL` 이면 전체공개(모든 주선자가 봄),
  아니면 그 모임 주선자만 봅니다. 회원도 자기와 같은 쪽만 보고 그 경계를 넘는 신청은
  DB 가 막습니다.
- 운영 흐름: `카카오톡 → 텔레그램 봇 또는 관리자 업로드 → AI 구조화 → 검토 → 게시`
- 카피: `좋은 사람을, 좋은 방식으로.`

상세 설계는 `docs/v2/`(원본 설계 문서)와 `docs/implementation-plan.md`(실제 구현 결정)를 봅니다.

## 기술 스택

| 영역     | 선택                                                                            |
| -------- | ------------------------------------------------------------------------------- |
| 모노레포 | pnpm workspace (`apps/*`, `packages/*`)                                         |
| 웹       | Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Zod 4          |
| API      | Next.js Route Handler (별도 백엔드 프로세스 없음)                               |
| DB       | PostgreSQL 17 (로컬 컨테이너), 순수 SQL 마이그레이션 + RLS                      |
| 인증     | 자체 세션(서명 쿠키 + `sessions`). 주선자 이메일/비밀번호, **회원은 초대 링크** |
| 스토리지 | 로컬 private 디렉터리 + HMAC signed URL                                         |
| AI       | provider 추상화. 기본 `mock`, `AI_PROVIDER=openai` 로 전환                      |
| Import   | 텔레그램 Bot API webhook (1차) + 관리자 웹 업로드. `TELEGRAM_ENABLED` 게이트     |

설계 문서의 Supabase는 로컬 대체물로 구현했습니다. 이유와 대응표는 `docs/implementation-plan.md`에 있습니다.
**RLS는 대체하지 않았습니다** — 런타임 롤 `bolsaram_app`은 `NOBYPASSRLS`이며 모든 접근이 정책을 통과합니다.

## 고정 인프라

- 웹(프론트+API) 포트: `3020`
- PostgreSQL: `127.0.0.1:5442` → 컨테이너 `5432`, DB `bolsaram`
  - `bolsaram_owner` — 마이그레이션·시드·인증 경로 전용 (RLS 우회)
  - `bolsaram_app` — 런타임 전용 (`NOBYPASSRLS`)
- DB 포트는 반드시 `127.0.0.1`에만 바인딩합니다. `0.0.0.0` 노출 시 외부 스캐너 접근 이력이 있습니다(2026-07-29).
- 접속 자격 증명 원본: `docker-compose.yml`. 문서에 비밀번호를 옮겨 적지 않습니다.
- 환경변수는 **리포 루트의 `.env`** 하나로 관리합니다. `apps/web/next.config.ts`가 이 파일을 읽어들입니다.
- v1 프로토타입 MariaDB(`3308`)는 `docker compose --profile legacy up mariadb` 로만 뜹니다. v2는 쓰지 않습니다.
- 백엔드 포트 `8010`은 더 이상 쓰지 않습니다(API가 웹 앱 안에 있음).

## 명령

```bash
pnpm install           # corepack 으로 pnpm 활성화 후

pnpm db:up             # Postgres 컨테이너 기동
pnpm db:migrate        # 마이그레이션 적용
pnpm db:seed           # 합성 시드 데이터
pnpm db:reset          # public 스키마 초기화 (개발 전용)

pnpm dev               # 개발 서버 (3020)
pnpm build && pnpm start

pnpm verify            # typecheck + lint + test — 마무리 전에 실행
pnpm typecheck
pnpm lint
pnpm test

pnpm pm2:start         # PM2 등록 + 저장 (최초 1회)
pnpm deploy:web        # 빌드 후 bolsaram-web 재시작
pnpm pm2:status        # 앱 상태
pnpm pm2:logs          # 로그 50줄
pnpm db:cleanup        # 만료 데이터 정리 (평소엔 cron 이 돌린다)
pnpm db:backup         # DB 백업 (평소엔 cron 이 03:40 에 돌린다)
pnpm db:backup:list    # 가진 백업 목록
pnpm db:backup:verify  # 최근 백업을 임시 DB 로 되살려 확인
pnpm db:purge-seed     # 합성 시드 정리 (기본은 미리보기, --yes 로 실제 삭제)

pnpm telegram:webhook  # 봇 webhook 등록 상태 (--set 등록, --delete 해제)
pnpm ai:check          # OpenAI 키·모델 사용 가능 여부

pnpm agents:sync       # 하네스 원본 → 에이전트별 설정 생성
pnpm agents:check      # 생성 파일 드리프트 검사
pnpm agents:test       # 셸 가드 판정 케이스 25개
```

회원 계정은 **초대 링크를 소비할 때만** 만들어집니다(`consumeInvite`).
자유 가입이 없고, 전화번호는 신원이 아니라 주선자가 기록하는 연락 수단입니다.

시드 계정:

- 주선자 `admin@bolsaram.local` — **이 호스트의 비밀번호는 교체됐습니다.**
  `pnpm db:seed` 가 만드는 기본값은 `bolsaram-admin` 이지만, 공개 도메인에 열려 있어
  2026-09-07 에 임의 값으로 바꿨습니다. 값을 모르면 `packages/db/src/cli/seed.ts` 의
  방식대로 해시를 새로 넣으세요. 또는 `/signup` 으로 새 주선자 계정을 만듭니다.
- 회원 `01020001000` ~ `01020001005` — **비밀번호가 없습니다.** 관리자 화면에서
  프로필 상세 → 초대 링크를 발급해 그 링크로 들어갑니다(매직 링크).

## PM2

| 앱                 | 역할             | 비고                                                 |
| ------------------ | ---------------- | ---------------------------------------------------- |
| `bolsaram-web`     | 웹 + API (3020)  | 상시. 코드 변경 시 빌드 후 재시작해야 반영된다       |
| `bolsaram-backup`  | DB 백업          | 매일 03:40 cron. 정리보다 **먼저** 돈다              |
| `bolsaram-cleanup` | 만료 데이터 정리 | 매일 04:10 cron. 매 실행 새 프로세스라 재시작 불필요 |

- 정의는 `ecosystem.config.cjs`. 루트 package.json 이 `type: module` 이라 확장자가 `.cjs` 다.
- 앱을 추가·변경하면 `pnpm pm2:save` 로 저장해야 재부팅 후에도 살아난다
  (이 호스트는 systemd `pm2-euro.service` 로 PM2 를 복원한다).
- 웹 앱은 `APP_ENV=production` 으로 뜬다. production 에서는 `APP_ORIGIN` 이 https 여야
  하고 `.env.example` 의 기본 시크릿을 쓸 수 없다(둘 다 기동 시 검증한다).
- **환경변수 가드가 걸리면 앱이 아무것도 서비스하지 않는다** — `instrumentation` 훅에서
  던지므로 포트는 열리지만 **모든 요청이 500** 이 된다. 프로세스가 죽지 않으니
  `pm2 status` 에는 `online` 으로 보인다. 설정을 바꾼 뒤에는 상태가 아니라 **기동 로그**를
  확인한다(실측 2026-09-07).
- **다른 프로젝트 앱(jongalab·trading·kiwoom)을 건드리지 않는다.** 항상 이름을 지정해 조작한다.

## 에이전트 하네스

`.agent-config/` 가 **단일 원본**이고 `sync.py` 가 에이전트별 설정을 생성한다.
생성 파일을 직접 고치면 다음 동기화에 덮어써지므로 가드가 편집을 막는다.

```
.agent-config/
  manifest.json     훅 on/off · 권한 · Codex 규칙
  sync.py           생성기 (--check 로 드리프트 검사)
  guard-cases.py    셸 가드 판정 케이스
  skills/           check · run-web · db-query · new-migration
  agents/           verify-agent · ui-agent
```

훅은 `.claude/hooks/` 에 있고 두 에이전트가 공유한다.

| 시점             | 훅                 | 하는 일                                     |
| ---------------- | ------------------ | ------------------------------------------- |
| SessionStart     | sync.py            | 생성 파일 동기화                            |
| PreToolUse       | guard-sensitive.sh | 민감 파일 편집·열람 차단 (셸 우회 포함)     |
| PostToolUse      | quality-gate.sh    | 해당 패키지 타입체크, 마이그레이션 RLS 검사 |
| PostToolUse      | track-changes.sh   | 변경 기록 + 건드린 축의 규칙 주입           |
| UserPromptSubmit | mark-turn-start.sh | 턴 시작 시각 기록                           |
| Stop             | deploy-on-stop.sh  | 빌드 + PM2 재시작, 미적용 마이그레이션 안내 |

가드가 막는 대상: 생성된 에이전트 설정, 비밀 파일, private 스토리지, **DB 백업**, 운영 로그,
**이미 적용된 마이그레이션**. 개인정보 디렉터리(`var/storage` · `var/backup` · `var/log`)는
어떤 명령의 인자로 나와도 막힌다 — 읽기 명령 목록에 없는 도구로 우회할 수 없다. 판정 기준은 `guard-bash-write.py` 가 단일 소스이며
`pnpm agents:test` 로 검증한다. 경로를 문자열로만 다뤄야 하는 경우(문서·테스트)는
Bash heredoc 대신 Write 도구를 쓴다.

### 비밀 파일 가드 일시 해제

`.env` 를 고쳐야 하는데 사용자가 명시적으로 요청한 경우에만 쓴다.

```bash
touch .claude/.allow-secret-edit   # 해제
# ... 수정 ...
rm .claude/.allow-secret-edit      # 즉시 복구
```

- **에이전트가 스스로 만들지 않는다.** 사용자 지시가 있을 때만이고, 작업이 끝나면 바로 지운다.
- 마커가 있어도 생성 설정 파일·private 스토리지·운영 로그·적용된 마이그레이션은 계속 막힌다.
- 마커는 gitignore 된다. 커밋되면 가드가 상시 꺼진 채로 배포된다.
- 마커를 만드는 명령과 비밀 파일을 다루는 명령은 **따로 실행**해야 한다.
  가드는 Bash 호출 하나를 통째로 먼저 판정하므로, 같은 블록에 넣으면 마커가 아직 없다.
- 이것과 별개로 Claude Code 의 `permissions.deny` 가 `Read(./.env)` 를 막는다.
  마커로는 그쪽이 풀리지 않으므로, 읽어야 한다면 `manifest.json` 의 deny 목록을 손봐야 한다.

## 구조

```
apps/web/src/
  app/            라우트. (member) 그룹 = 회원, admin/ = 관리자, api/ = Route Handler
  components/     ui/(공용) member/(감성 톤) admin/(CRM 톤)
  server/         서버 전용. auth/ repo/ services/ storage/ ai/ telegram/ notify/ views/ http/
packages/
  schemas/        Zod 스키마 + 도메인 열거형 (AI 추출 스키마의 single source)
  domain/         순수 도메인 로직 (상태 기계, 공개 규칙, 동의 판정, 필터 → SQL)
  db/             커넥션 풀 + RLS 컨텍스트 + 마이그레이션/시드 CLI
  ui-tokens/      디자인 토큰 (CSS + TS)
  config/         공용 tsconfig / eslint
db/migrations/    번호순 SQL. 적용된 파일은 절대 수정하지 않고 새 파일을 추가합니다.
tests/            vitest. 도메인 단위 + DB 통합
.agent-config/    에이전트 하네스 원본 (위 참고)
scripts/          운영 스크립트 (DB 백업, 시드 정리, webhook 등록, AI 키 확인)
ecosystem.config.cjs  PM2 정의
var/             private 스토리지 · DB 백업 · PM2 로그 (git 제외, 열람 금지)
```

## 디렉터리 README

주요 디렉터리마다 **그 안의 현재 구조**를 설명하는 README 가 있다. 코드를 고치기 전에
해당 README 부터 읽는다.

| 디렉터리             | 문서가 다루는 것                                       |
| -------------------- | ------------------------------------------------------ |
| `apps/web`           | 라우트·서버 모듈 구조, API 표, 요청 처리 흐름          |
| `packages/schemas`   | 스키마 파일 구성, AI 추출 스키마의 단일 원본 규칙      |
| `packages/domain`    | 상태 기계·공개 단계·필터 판정                          |
| `packages/db`        | 롤 두 개, `withRls` 동작, 마이그레이션 러너, 정리 작업 |
| `packages/ui-tokens` | 토큰 계열과 표면 클래스                                |
| `db`                 | 마이그레이션 목록, 테이블, DB 가 지키는 무결성         |
| `tests`              | 테스트 구성과 각 테스트가 지키는 성질                  |

**파일을 추가·삭제·이동했거나 책임·흐름이 바뀌면 같은 턴에 해당 README 를 갱신한다.**

어긋남은 `tests/docs-readme.test.ts` 가 잡는다(`pnpm verify` 에 포함). 검사하는 것:

- README 가 **없는 파일을 설명**하지 않는가 (죽은 참조)
- README 가 **있는 소스 파일을 빠뜨리지** 않았는가 (누락)
- 소스 오브 트루스 선언과 작업 규칙 링크가 있는가
- 루트 README 가 각 디렉터리를 안내하는가

라우트처럼 파일이 많고 규칙적인 곳은 디렉터리 단위로만 본다 — 파일마다 문서를 고치게
만들면 문서가 방치된다. 설명 문장과 표 내용은 검사하지 않는다.

### 세 계층을 구분한다

| 어디                          | 무엇을                                                    |
| ----------------------------- | --------------------------------------------------------- |
| 코드 주석                     | 지금 이 코드가 하는 일과 그렇게 한 이유 한두 줄           |
| 디렉터리 README               | **현재** 구조·불변식·주의점                               |
| `docs/implementation-plan.md` | 언제 무엇을 왜 바꿨는지(이력), 설계 문서와 다르게 간 결정 |

README 에 이력을 쓰지 않는다. "예전에는 …였는데 …로 바꿨다"는 문장이 들어가려 하면
구현 계획 문서로 보낸다.

## 사용자 문서 동기화

`docs/guide/` 는 **회원과 주선자가 읽는 문서**다. 개발자 문서가 아니다.

| 파일        | 대상                                   |
| ----------- | -------------------------------------- |
| `README.md` | 인덱스와 전체 흐름                     |
| `member.md` | 회원 — 로그인, 탐색, 신청, 시그널      |
| `admin.md`  | 주선자 — Import, 검토·게시, 초대, 연결 |
| `faq.md`    | 공통 질문과 오류 메시지                |
| `privacy.md`| 개인정보 처리방침 (코드 기준, 법률 검토 전) |

**사용자에게 보이는 동작이나 정책을 바꾸면 같은 턴에 가이드도 고친다.** 대상 축:
회원·관리자 화면, 인증(`server/auth/`), 상태 enum, 업로드 제한, PM2 스케줄.

어긋남은 `tests/docs-guide.test.ts` 가 잡는다(`pnpm verify` 에 포함). 검사하는 것:

- 가이드가 안내하는 화면 경로가 실제로 존재하는가
- 정책 숫자(인증번호 5분·재요청 30초·시도 5회·로그인 30일·초대 72시간·업로드 25MB·
  분석 6장·신뢰도 65%·정리 04:10·기본 필터 범위)가 코드와 같은가
- 상태 라벨(프로필·노출·신청)이 전부 설명돼 있는가
- 보안 약속(연결 전 이름 비공개, 비로그인 차단, AI 자동 게시 금지)이 적혀 있는가

정책을 의도적으로 바꿨다면 가이드와 이 테스트를 함께 고친다. 문구·표현은 검사하지 않는다.

문서를 쓸 때는 화면과 버튼으로 설명하고 파일 경로·함수명을 쓰지 않는다.
내부 구조 설명은 이 파일이나 `docs/` 상위에 둔다.

## 작업 규칙

- 사용자가 다른 언어를 요청하지 않는 한 응답과 요약은 한글로 작성합니다.
- UI 문구는 짧고 직접적이며 운영 도구처럼 명확하게 씁니다.
- 사용자가 명시적으로 요청하지 않는 한 커밋하지 않습니다.
- 사용자의 변경을 되돌리지 않습니다. 큰 변경 전에는 `git status --short`로 상태를 확인합니다.
- 요청된 동작에 필요한 범위로만 수정합니다.
- 생성물·의존성 디렉터리(`node_modules/`, `.next/`, `var/storage/`)는 수정하지 않습니다.
- 이 호스트에는 다른 프로젝트의 서버도 떠 있습니다(3000, 3001, 3307, 11434).
  `pkill -f next` 처럼 광범위한 종료 명령을 쓰지 말고 PID를 지정합니다.

## 코드 규칙

- `any` 남용 금지. 필요한 곳은 `eslint-disable`과 이유를 함께 씁니다.
- 에러를 삼키지 않습니다. 도메인 위반은 `DomainError`로 던지고 HTTP 레이어가 status로 번역합니다.
- **service-role/owner 커넥션을 인증 레이어 밖에서 쓰지 않습니다.** 일반 요청은 항상 `withRls(ctx, ...)`.
  텔레그램 webhook 도 예외가 아닙니다 — 신원 확인(`server/auth/telegram.ts`)만 owner 로 하고,
  그 뒤 모든 접근은 연결된 주선자 명의로 `withRls` 를 통과합니다.
- **외부에서 들어오는 payload 는 Zod 로 검증한 뒤에만 씁니다.** AI raw 출력과 같은 규칙입니다.
- 권한 검사는 RLS와 애플리케이션 레이어에 **중복으로** 둡니다. 한쪽만 믿지 않습니다.
- **`ADMIN` 이라는 사실만으로 권한을 주지 않습니다.** 가입이 열려 있기 때문입니다.
  **읽기와 쓰기를 다르게 줍니다** — 전체공개 프로필은 누구나 보지만 고치는 것은
  등록한 주선자만입니다(`app_can_view_profile_as_admin` vs `app_can_edit_profile`).
- **모임 소속(`group_admins`)을 바꾸는 것은 인증 레이어만 합니다.** 정책을 주지 않았고
  owner 커넥션의 가입·초대 경로만이 소속을 만듭니다.
- **claim 은 RLS 정책으로 열지 않습니다.** 주인 없는 프로필 연결은 해시된 초대 토큰을
  검증하는 인증 레이어에서만 일어납니다(0013 에서 열린 정책을 제거했습니다).
- private 이미지의 영구 URL을 만들지 않습니다. 응답마다 단기 signed URL을 새로 발급합니다.
- AI raw 출력은 반드시 Zod로 검증한 뒤에 씁니다. 검증 없이 저장·표시하지 않습니다.
- **사진을 AI 프로바이더에 보내지 않습니다.** 추출 근거는 프로필 원문뿐입니다
  (`ExtractionInput` 에 이미지 필드가 없습니다). 실측에서 사진은 기여가 없었고,
  실제 인물 사진을 외부로 보낼 이유가 없습니다.
- AI 결과를 자동 게시하지 않습니다. 게시 게이트는 UI가 아니라 도메인 레이어(`assertCommittable`)에 있습니다.
- **동의 기록 없이 게시하지 않습니다.** DB 가 「기록이 있는가」를 막고
  (`profiles_listed_requires_consent`), 「실제로 확인한 동의인가」는 도메인
  (`assertConsentForVisibility`)이 막습니다. 비공개로 내리는 것은 언제나 허용합니다.
- **알림은 아웃박스로 보냅니다.** 요청 트랜잭션 안에서 텔레그램을 호출하지 않습니다 —
  DB 트리거가 `notifications` 에 남기고 `server/notify/` 가 보냅니다. 알림 문구에는
  공개 번호만 싣습니다.
- 실제 인물 정보를 seed/fixture로 쓰지 않습니다. 시드는 전부 합성 데이터입니다.
- 로그에 프로필 원문·사진 URL·전화번호·초대 토큰을 남기지 않습니다.
- 상태 전이는 도메인 레이어에서 판정하고, DB에는 조건부 UPDATE(`WHERE status = <from>`)로 적용합니다.
- TODO에는 이유와 완료 조건을 씁니다.

## 아직 안 된 것

- **모바일 앱(Expo Share Extension/Intent)**: 미착수이며 **후순위**입니다. Import 1차 채널은
  텔레그램 봇입니다(`docs/implementation-plan.md` 「텔레그램 Import 채널」).
  `docs/share-spike-plan.md`에 계획만 있고, 실기기 검증 없이 공유 payload를 확정하지 않습니다.
- **텔레그램 봇 실기기 검증**: 완료했습니다(2026-09-07). `@bolsaram_bot` 이
  `bolsaram.rheeeuro.com` 의 webhook 으로 붙어 있습니다. 실측으로 확인된 사실 —
  카카오톡 「공유하기」로 여러 장을 보내면 텔레그램은 `media_group_id` 없이 개별
  메시지로 전달합니다. 사진을 묶는 것은 앨범이 아니라 **대화 세션**입니다.
  자세한 내용은 `docs/implementation-plan.md` 「실기기 검증 결과」.
- **카카오 챗봇 Import**: 폐기했습니다. 오픈빌더 스킬 payload 에 사용자 전송 이미지 필드가
  없습니다(`docs/v2/BOLSARAM_ARCHITECTURE_CHANGE_CHATBOT_v1.md` 배너 참고).
- **SMS**: 쓰지 않기로 했습니다(2026-09-07). 회원 로그인은 주선자가 카카오톡으로 보내는
  **초대 링크**입니다 — 링크가 세션을 만들고, 처음이면 회원 계정도 함께 만듭니다.
  전화번호 OTP 경로·`server/sms/`·`DEV_EXPOSE_OTP` 는 제거했습니다(0015).
  세션(30일)이 만료되면 주선자가 링크를 재발급합니다.
- **모임 전환 UI**: 없습니다. 한 사람은 한 모임에만 속하고, 옮기려면 나갔다가 초대
  코드로 다시 들어와야 합니다(나가기·참여는 `/admin/group` 에 있습니다).
- **주선자 비밀번호**: 이 호스트는 교체했습니다(2026-09-07). 다만 `pnpm db:seed` 는
  여전히 문서화된 기본값을 씁니다 — 새로 시드한 환경을 공개 주소에 붙이면 같은 문제가
  생깁니다. 시도 제한(15분 5회)은 **이미 알려진 비밀번호를 막지 못합니다.**
- **개인정보 처리방침 확정**: `docs/guide/privacy.md` 는 코드 기준 초안이며 **법률 검토를
  받지 않았습니다.** 등록 동의는 기록할 자리를 만들었고(0019) 기록 없이는 게시되지
  않지만, **무엇을 어떤 문구로 알릴지와 동의 철회 절차는 정해지지 않았습니다.**
  개인정보 보호책임자·문의 창구·사업자 정보도 비어 있습니다.
- **회원 알림**: 보내지 않기로 했습니다(2026-09-08). 주선자만 텔레그램으로 받고
  (`server/notify/`), 회원은 시그널 화면에서 직접 확인합니다. 회원용 채널을 새로
  만들지 않습니다 — 필요하면 주선자가 카카오톡으로 연락합니다.
- **호스트 밖 백업**: 기본 백업은 같은 디스크에 쌓입니다. `BACKUP_MIRROR_DIR` 로 다른
  마운트에 사본을 둘 수 있지만, 원격 저장소로 보내는 경로는 아직 없습니다.
- **시드 데이터 정리**: 이 호스트에는 아직 합성 프로필이 떠 있습니다.
  실회원을 받기 전에 `pnpm db:purge-seed --yes` 로 걷어내세요(표식은 `SYNTHETIC`).
