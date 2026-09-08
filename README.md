# 볼사람(Bolsaram)

> 좋은 사람을, 좋은 방식으로.

주선자가 검증해 등록한 사람만 참여하는 **비공개 소개팅 서비스**입니다.

- 회원: `프로필 탐색/필터 → 상세 → 마음 보내기 → 상대 수락 → 연락처 공개`
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

| 역할   | 로그인                                                                 |
| ------ | ---------------------------------------------------------------------- |
| 주선자 | `admin@bolsaram.local` / **시드 실행 결과에 출력되는 임의 비밀번호**   |
| 회원   | `01020001000` ~ `01020001005` — **비밀번호 없음. 초대 링크로 들어갑니다** |

회원 계정은 관리자 화면에서 프로필 상세 → 초대 링크를 발급해 그 링크로 로그인합니다.
자유 가입이 없고, 전화번호는 신원이 아니라 주선자가 기록하는 연락 수단입니다.

주선자 비밀번호는 **고정값이 아닙니다.** `pnpm db:seed` 가 계정을 새로 만들 때마다
임의로 만들어 실행 결과에 한 번 출력합니다. 값을 정해 두려면 `SEED_ADMIN_PASSWORD`
를 설정하세요(10자 이상). 계정이 이미 있으면 시드는 비밀번호를 건드리지 않습니다 —
값을 잃었다면 `SEED_ADMIN_PASSWORD` 를 주고 다시 시드하거나 `/signup` 으로 새 주선자
계정을 만듭니다.

시드의 이름·사진·연락처는 **전부 합성 데이터**이며 실존 인물과 무관합니다.

## 기술 스택

- **모노레포** pnpm workspace
- **웹/API** Next.js 16 App Router · React 19 · TypeScript strict · Tailwind v4 · Zod 4
- **DB** PostgreSQL 17 · 순수 SQL 마이그레이션 · Row Level Security
- **인증** 자체 세션(서명 쿠키 + DB 세션). 주선자 이메일/비밀번호, **회원은 초대 링크**
- **스토리지** 로컬 private 디렉터리 + 단기 HMAC signed URL
- **AI** provider 추상화 — 기본 `mock`, `AI_PROVIDER=openai`로 전환
- **Import** 텔레그램 봇 webhook(1차) + 관리자 웹 업로드
- **알림** DB 아웃박스 → 텔레그램 (주선자에게 신청·수락)

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
| `scripts`            | 운영 스크립트 (DB 백업, 시드 정리, webhook 등록, AI 키 확인, 가동 감시) | –                          |
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
| DB 백업          | `var/backup/` (git 제외, 열람 금지 — 실명·연락처) |

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

| 앱                 | 역할                                              | 스케줄     |
| ------------------ | ------------------------------------------------- | ---------- |
| `bolsaram-web`     | 웹 + API (3020)                                   | 상시       |
| `bolsaram-backup`  | `pg_dump` 백업 (14개 보관)                        | 매일 03:40 |
| `bolsaram-cleanup` | 만료 세션·초대·알림 정리, 방치된 Import 원본 삭제 | 매일 04:10 |

정의는 [ecosystem.config.cjs](ecosystem.config.cjs)에 있습니다. 이 호스트에는 다른 프로젝트의
PM2 앱도 함께 떠 있으니 항상 앱 이름을 지정해 조작하세요.

`APP_ENV`는 `NODE_ENV`와 분리된 축입니다. 웹 앱은 `APP_ENV=production`으로 뜨며,
이때 `APP_ORIGIN`이 https여야 하고 `.env.example`의 기본 시크릿을 쓸 수 없습니다.
둘 다 기동 훅에서 검증하므로 **걸리면 프로세스는 살아 있고 모든 요청이 500**이 됩니다 —
설정을 바꾼 뒤에는 `pm2 status`가 아니라 기동 로그를 확인하세요.

`pm2 restart`는 ecosystem의 env를 다시 읽지 않습니다. 환경을 바꿨다면
`pm2 restart ecosystem.config.cjs --only bolsaram-web --update-env`로 띄웁니다.

### 백업

```bash
pnpm db:backup          # 지금 한 개 만들기 (평소엔 PM2 cron 이 03:40 에)
pnpm db:backup:list     # 가진 백업
pnpm db:backup:verify   # 최근 백업을 임시 DB 로 되살려 확인
```

덤프는 14개까지 쌓이고 오래된 것부터 지워집니다. **기본 위치는 DB와 같은 디스크이므로
디스크가 통째로 죽는 경우는 막지 못합니다** — 막는 것은 실수로 지운 데이터, 잘못된
마이그레이션, 컨테이너 볼륨 손상입니다.

다른 디스크·마운트에 사본을 두려면 `.env`에 `BACKUP_MIRROR_DIR`를 절대경로로 넣으세요.
백업이 성공한 뒤에만 복사하고, 경로를 못 쓰면 **경고만 하고 기본 백업은 유지합니다** —
마운트가 빠졌다고 백업 자체를 잃으면 안 되기 때문입니다.

## 검증

```bash
pnpm verify        # typecheck + lint + test (311개)
pnpm agents:check  # 에이전트 설정 드리프트 검사
pnpm agents:test   # 셸 가드 판정 케이스 25개
```

DB 통합 테스트가 포함되어 있어 `pnpm db:up`이 필요합니다.

## 에이전트 하네스

Claude Code와 Codex가 같은 규칙으로 움직이도록 `.agent-config/`를 단일 원본으로 두고
`sync.py`가 에이전트별 설정을 생성합니다. 생성 파일을 직접 고치면 다음 동기화에 덮어써지므로
훅이 편집을 막습니다.

편집할 때마다 해당 패키지 타입체크와 마이그레이션 RLS 검사가 돌고, 턴이 끝나면 변경된 코드를
빌드해 PM2 앱을 재시작합니다. 비밀 파일·프로필 사진 저장소·DB 백업·운영 로그·이미 적용된
마이그레이션은 Edit 도구와 셸 양쪽에서 차단합니다.

자세한 내용은 [.ai-harness/project.md](.ai-harness/project.md)를 보세요.

## 보안

- 로그인하지 않으면 프로필을 **DB 레벨에서** 볼 수 없습니다(RLS).
- 정보는 단계적으로 공개됩니다 — 리스트(익명 코드·사진·출생연도·키·직업군·지역) →
  상세(소개·취미·이상형) → 연결 후(이름·연락처).
- 사진은 private 저장소에 있고 매 응답마다 새로 발급되는 단기 signed URL로만 접근합니다.
- 초대 토큰은 pepper를 섞은 해시로만 저장하며, claim은 원자적이라 재사용(replay)이 불가능합니다.
- 주선자에게 가는 텔레그램 알림에는 **공개 번호만** 싣습니다(이름·연락처 없음).
- 검색엔진 색인을 금지합니다.

## 아직 안 된 것

- **모바일 앱(Expo Share Extension / Android Share Intent)** — 미착수.
  [docs/share-spike-plan.md](docs/share-spike-plan.md)에 실기기 검증 계획이 있습니다.
  카카오톡의 공유 payload는 실기기 확인 전까지 확정하지 않습니다.
  현재 웹 Import Inbox가 같은 API 계약을 쓰므로, 모바일 추가 시 서버 변경은 필요 없습니다.
- **SMS 발송** — 쓰지 않기로 했습니다. 회원 로그인은 주선자가 카카오톡으로 보내는
  초대 링크(매직 링크)입니다.
- **회원 알림** — 보내지 않기로 했습니다. 주선자는 텔레그램으로 신청·수락 알림을 받고,
  회원은 시그널 화면에서 직접 확인합니다. 연락이 필요한 일은 주선자가 카카오톡으로 합니다.
- **개인정보 처리방침 확정** — [docs/guide/privacy.md](docs/guide/privacy.md)는 코드 기준
  초안이며 **법률 검토를 받지 않았습니다.** 등록되는 사람의 동의는 **주선자 책임**으로
  두고 시스템이 기록하지 않습니다. 운영자·보호책임자·문의 창구와 철회 절차는 채웠고
  `/privacy` 화면에서 로그인 없이 볼 수 있습니다. **법률 검토와 시행일이 남았습니다.**
- **호스트 밖 백업** — 기본 백업은 DB와 같은 디스크에 쌓입니다. 다른 마운트에 사본을
  두려면 `BACKUP_MIRROR_DIR`를 설정하세요(원격 저장소 연동은 아직 없습니다).
- **시드 데이터 정리** — 이 호스트에는 아직 합성 프로필이 떠 있습니다. 실회원을 받기 전에
  `pnpm db:purge-seed --yes`로 걷어내세요.
