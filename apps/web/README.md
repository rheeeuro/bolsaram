# @bolsaram/web — 웹 앱 (주선자 화면 + 회원 화면 + API)

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
> **불변식 5: 소속 여부가 공개 여부다.**
> `group_id IS NULL` 이면 전체공개(모든 주선자가 봄), 아니면 그 모임 전용이다.
> 주선자 가입이 열려 있으므로 `ADMIN` 이라는 사실만으로 권한을 주지 않는다 —
> **읽기와 쓰기를 다르게 준다.** 전체공개 프로필은 누구나 보지만 고치는 것은 등록한
> 주선자만이다. 모임 소속을 바꾸는 것(`group_admins`)은 인증 레이어만 할 수 있다.
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
│   ├── login/                주선자 로그인 (이메일·비밀번호)
│   ├── enter/                회원 입장 — 입장코드 하나만 묻는다
│   ├── signup/               주선자 가입 → 모임 생성
│   ├── claim/[token]/        초대 링크 → 프로필 연결 (실패 시 /enter 로 코드 유지)
│   ├── privacy/              개인정보 처리방침 — docs/guide/privacy.md 를 그대로 렌더 (로그인 불필요)
│   ├── (member)/             회원 영역 (하단 탭 레이아웃)
│   │   ├── discover/         프로필 목록 + 필터 시트
│   │   ├── discover/[id]/    상세 + 신청 모달 + 연출
│   │   ├── signals/          받은·보낸·연결됨
│   │   ├── favorites/        관심 목록
│   │   ├── hidden/           숨긴 사람 (해제는 상세에서)
│   │   └── me/               내 프로필 + 로그아웃
│   ├── (host)/               주선자 영역 (상단 네비 레이아웃)
│   │   ├── home/             오늘 할 일 + 지표 + 최근 신청
│   │   ├── imports/          가져오기 + 검토 상세
│   │   ├── profiles/         카드 목록 + 상세 편집·게시·초대
│   │   ├── requests/         신청 목록 + 연결 처리
│   │   ├── members/          초대·연결 현황
│   │   └── group/            모임 설정 · 주선자 구성원 · 초대 코드
│   └── api/                  Route Handler (아래 표)
├── components/
│   ├── ui/                   공용 primitive (button·field·chip·badge·empty·auth-shell·markdown)
│   ├── member/               회원 화면
│   └── host/                 주선자 화면 — 공통 표면·목록·패널
├── lib/
│   ├── api-client.ts         fetch 래퍼 — 오류를 판별 가능한 결과로 변환
│   ├── labels.ts             열거형 → 한글 라벨
│   ├── invite-code.ts        입장코드 정규화 (링크·공백 섞여 들어온 값에서 코드만)
│   ├── next-path.ts          `?next=` 검증 — 같은 출처 경로만
│   ├── markdown.ts           가이드 문서 마크다운 부분집합 → 블록 배열
│   └── cn.ts                 Tailwind 클래스 병합
└── server/                   서버 전용 (아래 참고)
```

### `server/` — 서버 전용 모듈

```
server/
├── env.ts                    환경변수 스키마 (production 은 https·기본 시크릿 금지)
├── crypto.ts                 HMAC·scrypt·랜덤 토큰·타이밍 안전 비교
├── audit.ts                  감사 로그 (민감값 제외)
├── auth/
│   ├── session.ts            서명 쿠키 + sessions 테이블
│   ├── login.ts              주선자 비밀번호 (15분 5회 시도 제한)
│   ├── invite.ts             초대 링크 = 회원 로그인 (매직 링크, 해시 저장·1회용)
│   ├── signup.ts             주선자 가입 (계정만) · 모임 만들기
│   ├── group-invite.ts       모임 초대 코드 발급·소비, 내 모임 조회
│   ├── telegram.ts           봇 계정 연결(해시 코드) + webhook 재전송 차단
│   └── guard.ts              requireUser / requireAdmin / requireMemberProfile
│                             (미로그인: 회원 화면 → /enter, 주선자 화면 → /login)
├── docs/guide.ts             docs/guide/ 문서 읽기 (파일명 화이트리스트)
├── storage/local.ts          private 저장소 + signed download/upload URL
├── ai/
│   ├── types.ts              프로바이더 인터페이스 · 시스템 프롬프트 · PROMPT_VERSION
│   ├── mock.ts               규칙 기반 추출기 (기본, API 키 불필요)
│   ├── openai.ts             OpenAI multimodal + Structured Outputs
│   └── index.ts              AI_PROVIDER 로 선택
├── repo/                     SQL 접근 (모두 withRls 트랜잭션 안에서 호출된다)
│   ├── profiles.ts           Discover·상세·주선자 목록·수정
│   ├── matches.ts            신청 생성·전이·시그널 목록·연결 상대
│   ├── favorites.ts          관심 토글·목록
│   ├── hides.ts              숨기기 토글·목록 + 양방향 판정
│   ├── imports.ts            세션·에셋·추출·검토
│   └── telegram.ts           봇 대화 상태 + 계정 연결 조회/해제
├── telegram/                 텔레그램 Import 채널 (Bot API 를 아는 유일한 곳)
│   ├── client.ts             Bot API 호출·파일 다운로드·webhook 서명 확인
│   ├── adapter.ts            Update → 신원 확인 → 의도 판정 → ImportSession
│   └── messages.ts           봇 응답 문구
├── notify/                   알림 아웃박스 → 텔레그램 발송
│   ├── outbox.ts             미발송 알림 선점·기록 (owner)
│   └── dispatch.ts           발송 루프 + 기동 시 주기 스윕
├── services/import-service.ts  분석 실행 + idempotent commit
├── views/profile-view.ts     공개 단계 적용 + signed URL 부착
└── http/
    ├── respond.ts            DomainError → HTTP status, 입력 검증
    └── context.ts            asUser / asAdmin / asGroupAdmin / asMember (세션 + RLS 묶음)
```

---

## API

인증이 필요 없는 경로는 없다(`/api/auth/*` 제외). 미인증은 401, 회원의 주선자 경로 접근은 403.

권한 열의 「주선자」는 DB 의 `ADMIN` 역할이다. 화면 경로에서 `/admin` 은 없앴지만
API 는 권한 경계를 경로에 드러내려고 `/api/admin/*` 을 유지한다.

`/api/health` 는 예외다. 밖에서 「살아 있는가」를 물어야 하는 경로라 로그인을 요구하지
않고, 대신 답에 개인정보도 설정값도 담지 않는다(상태 두 글자뿐이다).

알림에는 엔드포인트가 없다 — 신청·수락 경로가 발송을 띄우고 기동 시 스윕이 밀린 것을 줍는다.

텔레그램 webhook 만 세션 쿠키를 쓰지 않는다. 발신자 확인은 `setWebhook` 의 `secret_token`
(요청 헤더 `X-Telegram-Bot-Api-Secret-Token`)으로 하고, 채널이 꺼져 있으면 404 를 준다.

| 경로                                      | 메서드              | 권한              | 용도                                 |
| ----------------------------------------- | ------------------- | ----------------- | ------------------------------------ |
| `/api/auth/signup`                        | POST                | –                 | 주선자 가입 (계정만)                 |
| `/api/auth/admin-login`                   | POST                | –                 | 주선자 로그인 (15분 5회 시도 제한)   |
| `/api/auth/logout`                        | POST                | –                 | 세션 폐기                            |
| `/api/claim`                              | POST                | **초대 토큰**     | 회원 로그인 (매직 링크) + 최초 계정 생성 |
| `/api/profiles`                           | GET                 | 회원              | Discover 목록 (필터·커서)            |
| `/api/profiles/[id]`                      | GET / PATCH         | 회원 / 주선자     | 상세 조회 / 내용 수정                |
| `/api/profiles/[id]/status`               | PATCH               | 주선자            | 상태·노출 변경                       |
| `/api/match-requests`                     | GET / POST          | 회원(프로필 필요) | 시그널 목록 / 소개 신청              |
| `/api/match-requests/[id]/[action]`       | POST                | 당사자            | accept · reject · cancel             |
| `/api/admin/match-requests/[id]/[action]` | POST                | 주선자            | close                                |
| `/api/favorites`                          | GET / POST / DELETE | 회원              | 관심 목록·토글                       |
| `/api/hides`                              | GET / POST / DELETE | 회원(프로필 필요) | 숨긴 사람 목록·토글                  |
| `/api/admin/invites`                      | POST                | 주선자            | 초대 링크 · 입장코드 발급 (같은 토큰) |
| `/api/imports`                            | GET / POST          | 주선자            | 가져오기 목록 / 세션 생성 + 업로드 슬롯 |
| `/api/imports/[id]`                       | GET / DELETE        | 주선자            | 원본·추출 결과 / 세션 삭제           |
| `/api/imports/[id]/assets`                | POST / DELETE       | 주선자            | 업로드 확정·슬롯 추가 / 제거         |
| `/api/imports/[id]/text`                  | PATCH               | 주선자            | 원문 저장                            |
| `/api/imports/[id]/analyze`               | POST                | 주선자            | AI 추출 실행                         |
| `/api/imports/[id]/extraction`            | PATCH               | 주선자            | 검토 결과 저장                       |
| `/api/imports/[id]/commit`                | POST                | 주선자            | 프로필 생성 (idempotent)             |
| `/api/admin/groups`                       | POST                | 주선자            | 모임 만들기 (모임 없는 주선자)       |
| `/api/admin/group`                        | GET / PATCH / POST / PUT | 주선자       | 내 모임 / 이름·설명 수정 / 초대 코드 발급 / 코드로 참여 |
| `/api/admin/telegram`                     | GET / POST / DELETE | 주선자            | 봇 연결 상태 / 연결 코드 발급 / 해제 |
| `/api/integrations/telegram/webhook`      | POST                | **봇 시크릿**     | 텔레그램 Bot API webhook             |
| `/api/files`                              | GET                 | 로그인            | signed URL 로 이미지 다운로드        |
| `/api/uploads`                            | PUT                 | 주선자            | signed 토큰으로 직접 업로드          |
| `/api/health`                             | GET                 | –                 | 가동 확인 (DB 핑 포함, 실패 시 503)  |

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
목록·검토·commit 을 거치고, 게시 게이트(`assertCommittable`)를 우회하지 않는다.

owner 커넥션은 신원 확인 구간에서만 쓴다 — webhook 에는 세션 쿠키가 없어 RLS 컨텍스트를
만들 수 없기 때문이며, 신원이 정해진 뒤에는 일반 주선자 요청과 완전히 같다.

### 알림

```
회원의 신청·수락 (RLS 트랜잭션)
  → DB 트리거가 notifications 에 행 추가      담당 주선자 = app_profile_admins()
  → scheduleDispatch()                        응답을 기다리지 않고 띄운다
  → 디스패처가 선점(attempts+1) → 텔레그램 → sent_at
```

**요청 트랜잭션 안에서 텔레그램을 호출하지 않는다.** 회원 컨텍스트에서는 주선자의
텔레그램 연결을 읽을 수 없고(정책이 없다), 봇이 느리면 「마음 보내기」가 같이 느려진다.
보낼 것을 DB 에 남기므로 발송에 실패해도 신청은 남고 다음 스윕이 다시 시도한다.

`server/notify/` 는 owner 커넥션을 쓰는 유일한 비인증 경로다. 대신 닿는 범위를
`notifications` 와 `telegram_connections` 로 좁혔다 — 사람은 공개 번호로만 가리키고
이름·연락처는 알림에 싣지 않는다.

---

## 개발

```bash
pnpm dev                       # 개발 서버 (PM2 가 3020 을 쓰고 있으면 먼저 pm2 stop bolsaram-web)
pnpm --filter @bolsaram/web typecheck
pnpm deploy:web                # 빌드 + PM2 재시작
```

환경변수는 리포 루트 `.env` 하나로 관리하고 `next.config.ts` 가 읽어들인다.
`APP_ENV=production` 에서는 `APP_ORIGIN` 이 https 여야 하고 `.env.example` 의 기본
시크릿을 쓸 수 없다 — 둘 다 기동 훅에서 검증하며, 걸리면 모든 요청이 500 이 된다.

## 유지보수

- 라우트를 추가하면 위 API 표를 갱신한다.
- 사용자에게 보이는 동작이 바뀌면 [`docs/guide/`](../../docs/guide/) 도 같은 턴에 고친다
  (`tests/docs-guide.test.ts` 가 어긋남을 잡는다).
- 화면 작업은 모바일 390px 를 먼저 만족시킨다.
- 검증: `pnpm verify`, 그리고 `run-web` 스킬로 권한 경계를 실제 호출해 확인.
