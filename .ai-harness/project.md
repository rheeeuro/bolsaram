# AI 하네스: 볼사람

이 저장소는 Codex와 Claude Code가 함께 사용하는 프로젝트입니다. 두 도구 모두 코드를 변경하기 전에 이 파일의 기준을 따릅니다.

## 제품

볼사람(Bolsaram) — 주선자가 검증해 등록한 사람만 참여하는 비공개 소개팅 서비스.

- 회원 흐름: `프로필 탐색/필터 → 상세 → 마음 보내기 → 상대 수락 → 주선자 연결`
- 운영 흐름: `카카오톡 → 공유/업로드 → AI 구조화 → 검토 → 게시`
- 카피: `좋은 사람을, 좋은 방식으로.`

상세 설계는 `docs/v2/`(원본 설계 문서)와 `docs/implementation-plan.md`(실제 구현 결정)를 봅니다.

## 기술 스택

| 영역     | 선택                                                                            |
| -------- | ------------------------------------------------------------------------------- |
| 모노레포 | pnpm workspace (`apps/*`, `packages/*`)                                         |
| 웹       | Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Zod 4          |
| API      | Next.js Route Handler (별도 백엔드 프로세스 없음)                               |
| DB       | PostgreSQL 17 (로컬 컨테이너), 순수 SQL 마이그레이션 + RLS                      |
| 인증     | 자체 세션(서명 쿠키 + `sessions` 테이블). 관리자 이메일/비밀번호, 회원 전화 OTP |
| 스토리지 | 로컬 private 디렉터리 + HMAC signed URL                                         |
| AI       | provider 추상화. 기본 `mock`, `AI_PROVIDER=openai` 로 전환                      |

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
pnpm deploy            # 빌드 후 bolsaram-web 재시작
pnpm pm2:status        # 앱 상태
pnpm pm2:logs          # 로그 50줄
pnpm db:cleanup        # 만료 데이터 정리 (평소엔 cron 이 돌린다)

pnpm agents:sync       # 하네스 원본 → 에이전트별 설정 생성
pnpm agents:check      # 생성 파일 드리프트 검사
pnpm agents:test       # 셸 가드 판정 케이스 23개
```

시드 계정:

- 주선자 `admin@bolsaram.local` / `bolsaram-admin`
- 회원 `01020001000` ~ `01020001005` (OTP는 `DEV_EXPOSE_OTP=true`일 때 화면·콘솔에 표시)

## PM2

| 앱                 | 역할             | 비고                                                 |
| ------------------ | ---------------- | ---------------------------------------------------- |
| `bolsaram-web`     | 웹 + API (3020)  | 상시. 코드 변경 시 빌드 후 재시작해야 반영된다       |
| `bolsaram-cleanup` | 만료 데이터 정리 | 매일 04:10 cron. 매 실행 새 프로세스라 재시작 불필요 |

- 정의는 `ecosystem.config.cjs`. 루트 package.json 이 `type: module` 이라 확장자가 `.cjs` 다.
- 앱을 추가·변경하면 `pnpm pm2:save` 로 저장해야 재부팅 후에도 살아난다
  (이 호스트는 systemd `pm2-euro.service` 로 PM2 를 복원한다).
- 웹 앱은 `APP_ENV=staging` 으로 뜬다. 실제 배포 시 `production` 으로 바꾸고
  `DEV_EXPOSE_OTP` 를 지운다 — production 에서 그 값이 켜져 있으면 서버가 기동을 거부한다.
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

가드가 막는 대상: 생성된 에이전트 설정, 비밀 파일, private 스토리지, 운영 로그,
**이미 적용된 마이그레이션**. 판정 기준은 `guard-bash-write.py` 가 단일 소스이며
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
  server/         서버 전용. auth/ repo/ services/ storage/ ai/ views/ http/
packages/
  schemas/        Zod 스키마 + 도메인 열거형 (AI 추출 스키마의 single source)
  domain/         순수 도메인 로직 (상태 기계, 공개 규칙, 필터 → SQL)
  db/             커넥션 풀 + RLS 컨텍스트 + 마이그레이션/시드 CLI
  ui-tokens/      디자인 토큰 (CSS + TS)
  config/         공용 tsconfig / eslint
db/migrations/    번호순 SQL. 적용된 파일은 절대 수정하지 않고 새 파일을 추가합니다.
tests/            vitest. 도메인 단위 + DB 통합
.agent-config/    에이전트 하네스 원본 (위 참고)
ecosystem.config.cjs  PM2 정의
var/             private 스토리지와 PM2 로그 (git 제외, 열람 금지)
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
- 권한 검사는 RLS와 애플리케이션 레이어에 **중복으로** 둡니다. 한쪽만 믿지 않습니다.
- private 이미지의 영구 URL을 만들지 않습니다. 응답마다 단기 signed URL을 새로 발급합니다.
- AI raw 출력은 반드시 Zod로 검증한 뒤에 씁니다. 검증 없이 저장·표시하지 않습니다.
- AI 결과를 자동 게시하지 않습니다. 게시 게이트는 UI가 아니라 도메인 레이어(`assertCommittable`)에 있습니다.
- 실제 인물 정보를 seed/fixture로 쓰지 않습니다. 시드는 전부 합성 데이터입니다.
- 로그에 프로필 원문·사진 URL·전화번호·초대 토큰을 남기지 않습니다.
- 상태 전이는 도메인 레이어에서 판정하고, DB에는 조건부 UPDATE(`WHERE status = <from>`)로 적용합니다.
- TODO에는 이유와 완료 조건을 씁니다.

## 아직 안 된 것

- **모바일 앱(Expo Share Extension/Intent)**: 미착수. `docs/share-spike-plan.md`에 계획만 있습니다.
  실기기 검증 없이 카카오톡 공유 payload를 확정하지 않습니다.
- **SMS 발송**: 미연동. 운영 배포 전에 어댑터가 필요합니다(`apps/web/src/server/auth/login.ts`의 TODO).
- **PM2 배포 구성**: 없음. 필요해지면 새로 작성합니다.
