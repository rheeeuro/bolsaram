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
```

시드 계정:

- 주선자 `admin@bolsaram.local` / `bolsaram-admin`
- 회원 `01020001000` ~ `01020001005` (OTP는 `DEV_EXPOSE_OTP=true`일 때 화면·콘솔에 표시)

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
```

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
