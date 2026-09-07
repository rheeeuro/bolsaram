# 볼사람(Bolsaram)

> 좋은 사람을, 좋은 방식으로.

주선자가 검증해 등록한 사람만 참여하는 **비공개 소개팅 서비스**입니다.

- 회원: `프로필 탐색/필터 → 상세 → 마음 보내기 → 상대 수락 → 주선자 연결`
- 주선자: `카카오톡 프로필 → 업로드/공유 → AI 구조화 → 검토 → 게시`

설계 원본은 [docs/v2/](docs/v2/), 실제 구현 결정과 진행 상황은
[docs/implementation-plan.md](docs/implementation-plan.md)에 있습니다.

**서비스를 쓰는 분은 [사용 가이드](docs/guide/README.md)를 보세요** —
[회원용](docs/guide/member.md) · [주선자용](docs/guide/admin.md) · [FAQ](docs/guide/faq.md)

## 빠르게 시작하기

```bash
corepack enable pnpm
pnpm install

cp .env.example .env
# .env 를 열어 SESSION_SECRET / STORAGE_SECRET / INVITE_TOKEN_PEPPER 를 채우고
# STORAGE_ROOT 를 이 저장소의 절대경로(<repo>/var/storage)로 지정합니다.
#   openssl rand -hex 32

pnpm db:up        # PostgreSQL 컨테이너
pnpm db:migrate   # 스키마 + RLS
pnpm db:seed      # 합성 시드 데이터

pnpm dev          # http://127.0.0.1:3020
```

### 시드 계정

| 역할   | 로그인                                                        |
| ------ | ------------------------------------------------------------- |
| 주선자 | `admin@bolsaram.local` / `bolsaram-admin`                     |
| 회원   | `01020001000` ~ `01020001005` (OTP는 화면과 서버 콘솔에 표시) |

`DEV_EXPOSE_OTP=true`인 개발 환경에서만 OTP가 노출됩니다. 운영 모드에서는 서버가 기동을 거부합니다.
시드의 이름·사진·연락처는 **전부 합성 데이터**이며 실존 인물과 무관합니다.

## 기술 스택

- **모노레포** pnpm workspace
- **웹/API** Next.js 16 App Router · React 19 · TypeScript strict · Tailwind v4 · Zod 4
- **DB** PostgreSQL 17 · 순수 SQL 마이그레이션 · Row Level Security
- **인증** 자체 세션(서명 쿠키 + DB 세션). 관리자 이메일/비밀번호, 회원 전화 OTP
- **스토리지** 로컬 private 디렉터리 + 단기 HMAC signed URL
- **AI** provider 추상화 — 기본 `mock`, `AI_PROVIDER=openai`로 전환

설계 문서는 Supabase를 전제하지만, 외부 계정 없이 전체 플로우를 실제로 돌려 검증할 수 있도록
로컬 대체물로 구현했습니다. 대응표는 [docs/implementation-plan.md](docs/implementation-plan.md)에 있습니다.
**RLS는 대체하지 않았습니다** — 런타임 롤은 `NOBYPASSRLS`이며 모든 접근이 정책을 통과합니다.

## 구조

각 디렉터리에는 **그 안의 현재 구조를 설명하는 README** 가 있습니다. 코드를 고치기 전에
해당 README 부터 읽으세요.

| 디렉터리             | 역할                                                        | 문서                                   |
| -------------------- | ----------------------------------------------------------- | -------------------------------------- |
| `apps/web`           | Next.js 앱 — 회원 화면 + 관리자 화면 + API                  | [README](apps/web/README.md)           |
| `packages/schemas`   | Zod 스키마 · 도메인 열거형 · AI 추출 스키마(단일 원본)      | [README](packages/schemas/README.md)   |
| `packages/domain`    | 순수 도메인 로직 — 상태 기계, 정보 공개, 필터               | [README](packages/domain/README.md)    |
| `packages/db`        | 커넥션 풀 · RLS 컨텍스트 · 마이그레이션/시드 CLI            | [README](packages/db/README.md)        |
| `packages/ui-tokens` | 디자인 토큰                                                 | [README](packages/ui-tokens/README.md) |
| `packages/config`    | 공용 tsconfig / eslint                                      | –                                      |
| `db`                 | 스키마와 마이그레이션 (RLS 정책 포함)                       | [README](db/README.md)                 |
| `tests`              | vitest — 도메인 단위 + DB 통합                              | [README](tests/README.md)              |
| `scripts`            | 운영 스크립트 (텔레그램 webhook 등록, AI 키 확인) |
| `docs`               | 설계 문서 · 구현 계획 · [사용 가이드](docs/guide/README.md) | –                                      |

이 README 들은 코드가 바뀌면 함께 갱신합니다. 어긋나면 `tests/docs-readme.test.ts` 가 잡습니다.

## 인프라

| 항목             | 값                                                |
| ---------------- | ------------------------------------------------- |
| 웹(프론트 + API) | `3020`                                            |
| PostgreSQL       | `127.0.0.1:5442` → 컨테이너 `5432`, DB `bolsaram` |
| 컨테이너         | `bolsaram_postgres` (`postgres:17`)               |
| 데이터 볼륨      | `bolsaram_pg_data`                                |
| private 스토리지 | `var/storage/` (git 제외, 정적 서빙 안 됨)        |

- 비밀번호를 포함한 접속 정보 원본은 [docker-compose.yml](docker-compose.yml)에 있습니다.
- DB 포트는 `127.0.0.1`에만 바인딩합니다. `0.0.0.0`으로 열어둔 동안 외부 스캐너가 접근한 이력이 있습니다(2026-07-29).
- v1 프로토타입 MariaDB는 `docker compose --profile legacy up mariadb`로만 뜹니다.
  이전 구현은 git 태그 `archive/v1-prototype`에 있습니다.

## 운영 (PM2)

```bash
pnpm pm2:start    # 최초 등록 + 저장
pnpm deploy:web   # 빌드 후 재시작
pnpm pm2:status   # 상태
pnpm pm2:logs     # 로그
```

| 앱                 | 역할                                             | 스케줄     |
| ------------------ | ------------------------------------------------ | ---------- |
| `bolsaram-web`     | 웹 + API (3020)                                  | 상시       |
| `bolsaram-cleanup` | 만료 세션·OTP·초대 정리, 방치된 Import 원본 삭제 | 매일 04:10 |

정의는 [ecosystem.config.cjs](ecosystem.config.cjs)에 있습니다. 이 호스트에는 다른 프로젝트의
PM2 앱도 함께 떠 있으니 항상 앱 이름을 지정해 조작하세요.

`APP_ENV`는 `NODE_ENV`와 분리된 축입니다. PM2로 띄우면 `NODE_ENV=production`이지만
아직 실제 사용자를 받지 않는 스테이징이므로 `APP_ENV=staging`으로 두어 회원 OTP 로그인을
확인할 수 있습니다. **실제 배포 시 `production`으로 바꾸고 `DEV_EXPOSE_OTP`를 지우세요** —
그 조합이면 서버가 기동을 거부합니다.

## 검증

```bash
pnpm verify        # typecheck + lint + test (171개)
pnpm agents:check  # 에이전트 설정 드리프트 검사
pnpm agents:test   # 셸 가드 판정 케이스 23개
```

DB 통합 테스트가 포함되어 있어 `pnpm db:up`이 필요합니다.

## 에이전트 하네스

Claude Code와 Codex가 같은 규칙으로 움직이도록 `.agent-config/`를 단일 원본으로 두고
`sync.py`가 에이전트별 설정을 생성합니다. 생성 파일을 직접 고치면 다음 동기화에 덮어써지므로
훅이 편집을 막습니다.

편집할 때마다 해당 패키지 타입체크와 마이그레이션 RLS 검사가 돌고, 턴이 끝나면 변경된 코드를
빌드해 PM2 앱을 재시작합니다. 비밀 파일·프로필 사진 저장소·이미 적용된 마이그레이션은
Edit 도구와 셸 양쪽에서 차단합니다.

자세한 내용은 [.ai-harness/project.md](.ai-harness/project.md)를 보세요.

## 보안

- 로그인하지 않으면 프로필을 **DB 레벨에서** 볼 수 없습니다(RLS).
- 정보는 단계적으로 공개됩니다 — 리스트(익명 코드·사진·출생연도·키·직업군·지역) →
  상세(소개·취미·이상형) → 연결 후(이름·연락처).
- 사진은 private 저장소에 있고 매 응답마다 새로 발급되는 단기 signed URL로만 접근합니다.
- 초대 토큰은 pepper를 섞은 해시로만 저장하며, claim은 원자적이라 재사용(replay)이 불가능합니다.
- 검색엔진 색인을 금지합니다.

## 아직 안 된 것

- **모바일 앱(Expo Share Extension / Android Share Intent)** — 미착수.
  [docs/share-spike-plan.md](docs/share-spike-plan.md)에 실기기 검증 계획이 있습니다.
  카카오톡의 공유 payload는 실기기 확인 전까지 확정하지 않습니다.
  현재 웹 Import Inbox가 같은 API 계약을 쓰므로, 모바일 추가 시 서버 변경은 필요 없습니다.
- **SMS 발송** — 미연동. 운영 배포 전 어댑터가 필요합니다.
- **배포 구성(PM2 등)** — 없음.
