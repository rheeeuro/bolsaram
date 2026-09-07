# @bolsaram/web — 웹 앱 (회원 화면 + 관리자 화면 + API)

Next.js 16 App Router 단일 앱. 프론트엔드와 API 가 한 프로세스에 있고 `:3020` 에서 뜬다.
별도 백엔드 프로세스는 없다.

> **불변식 1: 권한 검사는 RLS 와 애플리케이션 레이어에 중복으로 둔다.**
> `withRls` 로 정책을 통과시키고, 그와 별개로 `requireUser` / `requireAdmin` /
> `requireMemberProfile` 로 한 번 더 막는다. 한쪽만 믿지 않는다.
>
> **불변식 2: private 이미지의 영구 URL 을 만들지 않는다.**
> 응답마다 단기 signed URL 을 새로 발급한다. 그래서 `next/image` 최적화를 쓰지 않는다
> (캐시된 URL 이 만료되면 사진이 깨진다).
>
> **불변식 3: 공개 범위를 화면에서 넓히지 않는다.**
> 무엇을 보여줄지는 `@bolsaram/domain` 의 `projectProfile` 이 정한다.
> 서버가 주지 않은 필드를 컴포넌트에서 만들어내지 않는다.
>
> **불변식 4: 로그에 프로필 원문·사진 URL·전화번호·초대 토큰을 남기지 않는다.**
>
> 이 README 는 현재 구조의 소스 오브 트루스다. 라우트·서버 모듈을 추가·삭제하면 함께 갱신한다.
> 작업 규칙은 [`.ai-harness/project.md`](../../.ai-harness/project.md) 를 따른다.

---

## 코드 구조

```
apps/web/src/
├── instrumentation.ts        기동 훅 — 런타임 분기만 (Node/Edge 양쪽에서 평가된다)
├── startup-node.ts           Node 기동 작업 — 환경변수 검증 + 해외 API 연결 대기시간
├── app/
│   ├── page.tsx              인트로 (로그인 상태면 역할별 리다이렉트)
│   ├── layout.tsx            폰트·메타데이터·noindex
│   ├── globals.css           Tailwind + 디자인 토큰 + 전역 스타일
│   ├── login/                로그인 (회원 OTP / 주선자 비밀번호 탭)
│   ├── claim/[token]/        초대 링크 → 프로필 연결
│   ├── (member)/             회원 영역 (하단 탭 레이아웃)
│   │   ├── discover/         프로필 목록 + 필터 시트
│   │   ├── discover/[id]/    상세 + 신청 모달 + 연출
│   │   ├── signals/          받은·보낸·연결됨
│   │   ├── favorites/        관심 목록
│   │   └── me/               내 프로필 + 로그아웃
│   ├── admin/                관리자 영역 (상단 네비 레이아웃)
│   │   ├── page.tsx          대시보드 KPI
│   │   ├── imports/          Import Inbox + 검토 상세
│   │   ├── profiles/         목록 + 상세 편집·게시·초대
│   │   ├── requests/         신청 목록 + 연결 처리
│   │   └── members/          초대·연결 현황
│   └── api/                  Route Handler (아래 표)
├── components/
│   ├── ui/                   공용 primitive (button·field·chip·badge·empty)
│   ├── member/               회원 화면 (감성 톤)
│   └── admin/                관리자 화면 (CRM 톤)
├── lib/
│   ├── api-client.ts         fetch 래퍼 — 오류를 판별 가능한 결과로 변환
│   ├── labels.ts             열거형 → 한글 라벨
│   └── cn.ts                 Tailwind 클래스 병합
└── server/                   서버 전용 (아래 참고)
```

### `server/` — 서버 전용 모듈

```
server/
├── env.ts                    환경변수 스키마 (APP_ENV 로 개발 편의 기능 게이트)
├── crypto.ts                 HMAC·scrypt·OTP 생성·타이밍 안전 비교
├── audit.ts                  감사 로그 (민감값 제외)
├── auth/
│   ├── session.ts            서명 쿠키 + sessions 테이블
│   ├── login.ts              관리자 비밀번호 · 회원 OTP (재요청·시도 제한)
│   ├── invite.ts             초대 발급·미리보기·claim (해시 저장, replay 차단)
│   ├── telegram.ts           봇 계정 연결(해시 코드) + webhook 재전송 차단
│   └── guard.ts              requireUser / requireAdmin / requireMemberProfile
├── storage/local.ts          private 저장소 + signed download/upload URL
├── ai/
│   ├── types.ts              프로바이더 인터페이스 · 시스템 프롬프트 · PROMPT_VERSION
│   ├── mock.ts               규칙 기반 추출기 (기본, API 키 불필요)
│   ├── openai.ts             OpenAI multimodal + Structured Outputs
│   └── index.ts              AI_PROVIDER 로 선택
├── repo/                     SQL 접근 (모두 withRls 트랜잭션 안에서 호출된다)
│   ├── profiles.ts           Discover·상세·관리자 목록·수정
│   ├── matches.ts            신청 생성·전이·시그널 목록·연결 상대
│   ├── favorites.ts          관심 토글·목록
│   ├── imports.ts            세션·에셋·추출·검토
│   └── telegram.ts           봇 대화 상태 + 계정 연결 조회/해제
├── telegram/                 텔레그램 Import 채널 (Bot API 를 아는 유일한 곳)
│   ├── client.ts             Bot API 호출·파일 다운로드·webhook 서명 확인
│   ├── adapter.ts            Update → 신원 확인 → 의도 판정 → ImportSession
│   └── messages.ts           봇 응답 문구
├── services/import-service.ts  분석 실행 + idempotent commit
├── views/profile-view.ts     공개 단계 적용 + signed URL 부착
└── http/
    ├── respond.ts            DomainError → HTTP status, 입력 검증
    └── context.ts            asUser / asAdmin / asMember (세션 + RLS 묶음)
```

---

## API

인증이 필요 없는 경로는 없다(`/api/auth/*` 제외). 미인증은 401, 회원의 관리자 경로 접근은 403.

텔레그램 webhook 만 세션 쿠키를 쓰지 않는다. 발신자 확인은 `setWebhook` 의 `secret_token`
(요청 헤더 `X-Telegram-Bot-Api-Secret-Token`)으로 하고, 채널이 꺼져 있으면 404 를 준다.

| 경로                                      | 메서드              | 권한              | 용도                                 |
| ----------------------------------------- | ------------------- | ----------------- | ------------------------------------ |
| `/api/auth/admin-login`                   | POST                | –                 | 주선자 로그인                        |
| `/api/auth/otp/request`                   | POST                | –                 | 회원 인증번호 발급                   |
| `/api/auth/otp/verify`                    | POST                | –                 | 인증번호 확인 → 세션                 |
| `/api/auth/logout`                        | POST                | –                 | 세션 폐기                            |
| `/api/claim`                              | POST                | 회원              | 초대 토큰으로 프로필 연결            |
| `/api/profiles`                           | GET                 | 회원              | Discover 목록 (필터·커서)            |
| `/api/profiles/[id]`                      | GET / PATCH         | 회원 / 관리자     | 상세 조회 / 내용 수정                |
| `/api/profiles/[id]/status`               | PATCH               | 관리자            | 상태·노출 변경                       |
| `/api/match-requests`                     | GET / POST          | 회원(프로필 필요) | 시그널 목록 / 소개 신청              |
| `/api/match-requests/[id]/[action]`       | POST                | 당사자            | accept · reject · cancel             |
| `/api/admin/match-requests/[id]/[action]` | POST                | 관리자            | introduce · close                    |
| `/api/favorites`                          | GET / POST / DELETE | 회원              | 관심 목록·토글                       |
| `/api/admin/invites`                      | POST                | 관리자            | 초대 링크 발급                       |
| `/api/imports`                            | GET / POST          | 관리자            | Inbox 목록 / 세션 생성 + 업로드 슬롯 |
| `/api/imports/[id]`                       | GET / DELETE        | 관리자            | 원본·추출 결과 / 세션 삭제           |
| `/api/imports/[id]/assets`                | POST / DELETE       | 관리자            | 업로드 확정·슬롯 추가 / 제거         |
| `/api/imports/[id]/text`                  | PATCH               | 관리자            | 원문 저장                            |
| `/api/imports/[id]/analyze`               | POST                | 관리자            | AI 추출 실행                         |
| `/api/imports/[id]/extraction`            | PATCH               | 관리자            | 검토 결과 저장                       |
| `/api/imports/[id]/commit`                | POST                | 관리자            | 프로필 생성 (idempotent)             |
| `/api/admin/telegram`                     | GET / POST / DELETE | 관리자            | 봇 연결 상태 / 연결 코드 발급 / 해제 |
| `/api/integrations/telegram/webhook`      | POST                | **봇 시크릿**     | 텔레그램 Bot API webhook             |
| `/api/files`                              | GET                 | 로그인            | signed URL 로 이미지 다운로드        |
| `/api/uploads`                            | PUT                 | 관리자            | signed 토큰으로 직접 업로드          |

---

## 핵심 흐름

### 요청 처리

```
Route Handler
  → route()          오류를 status 로 번역, 예상 못 한 오류는 서버에만 기록
  → asUser/asAdmin   세션 읽기 + 권한 확인 + withRls 트랜잭션
  → repo/*           SQL (정책이 적용된 상태)
  → views/*          공개 단계 적용 + signed URL 부착
```

### 이미지

업로드는 서버가 키를 정하고 서명 토큰을 발급한다 — 클라이언트가 경로를 정할 수 없다.
다운로드는 서명 + **로그인**을 함께 요구한다. URL 이 유출돼도 외부인은 쓸 수 없다.
시드가 만든 SVG 는 CSP `sandbox` 로 스크립트를 무력화해 서빙한다(업로드 허용 목록에는 없다).

### Import

`세션 생성 → signed 업로드 → 확정 → 원문 → 분석 → 검토 → commit`.
commit 은 `idempotency_key` 를 조건부로 선점해 같은 세션에서 프로필이 두 개 생기지 않게 한다.
분석은 프로바이더 호출이 길어 RLS 트랜잭션 **밖에서** 하고 앞뒤로만 DB 를 만진다.

### 텔레그램 Import

```
webhook
  → secret_token 확인            채널이 꺼져 있으면 404
  → update_id 선점               재전송이면 여기서 끝 (owner)
  → 텔레그램 계정 → 주선자 신원  연결 안 됐으면 안내만 (owner)
  → 의도 판정                    domain 의 classifyTelegramMessage
  → withRls(주선자) 로 세션 갱신 사진 다운로드는 트랜잭션 밖
  → 200 응답 + 분석은 따로 띄움
```

**입력 채널만 추가한 것이며 Import 도메인은 그대로다.** 봇으로 들어온 세션도 같은
Inbox·검토·commit 을 거치고, 게시 게이트(`assertCommittable`)를 우회하지 않는다.

owner 커넥션은 신원 확인 구간에서만 쓴다 — webhook 에는 세션 쿠키가 없어 RLS 컨텍스트를
만들 수 없기 때문이며, 신원이 정해진 뒤에는 일반 관리자 요청과 완전히 같다.

---

## 개발

```bash
pnpm dev                       # 개발 서버 (PM2 가 3020 을 쓰고 있으면 먼저 pm2 stop bolsaram-web)
pnpm --filter @bolsaram/web typecheck
pnpm deploy:web                # 빌드 + PM2 재시작
```

환경변수는 리포 루트 `.env` 하나로 관리하고 `next.config.ts` 가 읽어들인다.
`APP_ENV=production` 에서는 개발 편의 기능(OTP 화면 노출)이 잠긴다.

## 유지보수

- 라우트를 추가하면 위 API 표를 갱신한다.
- 사용자에게 보이는 동작이 바뀌면 [`docs/guide/`](../../docs/guide/) 도 같은 턴에 고친다
  (`tests/docs-guide.test.ts` 가 어긋남을 잡는다).
- 화면 작업은 모바일 390px 를 먼저 만족시킨다.
- 검증: `pnpm verify`, 그리고 `run-web` 스킬로 권한 경계를 실제 호출해 확인.
