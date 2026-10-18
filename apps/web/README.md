# @bolsaram/web — 웹 앱 (주선자 화면 + 멤버 화면 + API)

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
> **읽기와 쓰기를 다르게 준다.** 전체공개 프로필은 누구나, 모임 프로필은 그 모임
> 주선자가 보지만 고치는 것은 **어느 쪽이든 등록한 주선자만**이다 — 초대 링크·대행·
> Import 검토도 같다. 모임 소속을 바꾸는 것(`group_admins`)은 인증 레이어만 할 수 있다.
> **이름과 연락처도 주선자라는 사실만으로 열지 않는다** — 담당이 아닌 프로필은
> 멤버와 같은 기준을 쓰고(`disclosureFor` 의 `canEdit`), 자기 멤버와 연결된 뒤에
> 열린다. 그전에 필요하면 대행으로 멤버 화면에서 보고 감사에 남긴다.
>
> **불변식 6: 보고 있는 모임은 화면 필터이지 권한이 아니다.**
> 한 주선자가 여러 모임에 속한다. `viewer.groupId`(= `users.active_group_id`)는 그중
> 지금 보고 있는 하나이고 `null` 이면 전체공개다. 주선자 목록은 이 값으로 좁히지만,
> **무엇을 볼 수 있는지는 RLS 가 속한 모임 전부로 판정한다.** 목록에서 좁히는 것을
> 권한 검사로 세지 않는다.
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
│   ├── layout.tsx            폰트·메타데이터·기본 noindex
│   ├── robots.ts             크롤링 범위 — `/`·`/privacy` 만 열고 나머지 차단
│   ├── sitemap.ts            검색 노출 페이지 목록 (`/`·`/privacy`)
│   ├── globals.css           Tailwind + 디자인 토큰 + 전역 스타일
│   ├── login/                주선자 로그인 = 가입 (카카오·구글)
│   ├── enter/                멤버 입장 — 입장코드 하나만 묻는다
│   ├── claim/[token]/        초대 링크 → 프로필 연결 (실패 시 /enter 로 코드 유지)
│   ├── privacy/              개인정보 처리방침 — docs/guide/privacy.md 를 그대로 렌더 (로그인 불필요)
│   ├── guide/                주선자 시작 가이드 — docs/guide/start.md + 화면 사진 (로그인 불필요, 색인 안 함)
│   ├── updates/              업데이트 소식 — docs/guide/updates.md 를 그대로 렌더 (로그인 불필요, 색인 안 함)
│   ├── (member)/             멤버 영역 (하단 탭 레이아웃)
│   │   ├── discover/         프로필 목록 + 필터 시트
│   │   ├── discover/[id]/    상세 + 신청 모달 + 연출
│   │   ├── signals/          받은·보낸·연결됨
│   │   ├── favorites/        관심 목록
│   │   ├── hidden/           숨긴 사람 (해제는 상세에서)
│   │   └── me/               내 프로필 + 로그아웃
│   ├── (host)/               주선자 영역 (PC 왼쪽 사이드바 · 모바일 상단 모임 + 하단 탭)
│   │   ├── home/             오늘 할 일 + 지표 + 최근 신청
│   │   ├── account/          계정 설정 — 내 이름·로그인 방식·텔레그램 연결·로그아웃
│   │   ├── imports/          가져오기 + 검토 상세
│   │   ├── profiles/         카드 목록 · 원본 목록(?view=raw) + 상세(게시·끌어올리기·초대·대행)
│   ├── profiles/trace/   캡처본 확인 — 유출 사진의 숨은 워터마크를 브라우저에서 드러낸다 (DB 안 읽음)
│   │   ├── profiles/[id]/edit/  내용 편집 — 등록한 주선자만
│   │   ├── requests/         신청 목록 + 연결 처리
│   │   ├── invites/          초대 — 안 보냄·기한 지남·기다림·들어옴 순서 (옛 주소 /members 는 next.config 가 넘긴다)
│   │   ├── chat/             보고 있는 모임의 채팅방 크게 보기 (주선자 전용). 평소에는 오른쪽 아래 버튼이 그 자리에 패널로 연다
│   │   ├── group/[id]/       모임 설정 — 이름·주선자·초대 코드·알림·나가기·폐쇄
│   │   └── operator/         관리자 메뉴 (관리자 계정만) — 메뉴 목록 + groups/ 모임 설정(모임 만들기 승인·초대 코드 여러 번 쓰기·요청 처리) + hosts/ 주선자 목록·정지
│   └── api/                  Route Handler (아래 표)
├── components/
│   ├── ui/                   공용 primitive (button·field·chip·badge·empty·dialog·menu·skeleton·auth-shell·markdown·brand-logo·provider-mark·marks·avatar·image-cropper·photo-viewer·global-progress)
│   ├── member/               멤버 화면
│   └── host/                 주선자 화면 — 공통 표면·목록·패널·스켈레톤 블록
├── lib/
│   ├── api-client.ts         fetch 래퍼 — 오류를 판별 가능한 결과로 변환
│   ├── labels.ts             열거형 → 한글 라벨
│   ├── dates.ts              시각 표기 (서울 시간대 고정 — 서버·클라이언트가 같은 글자)
│   ├── invite-code.ts        입장코드 정규화 (링크·공백 섞여 들어온 값에서 코드만)
│   ├── next-path.ts          `?next=` 검증 — 같은 출처 경로만
│   ├── markdown.ts           가이드 문서 마크다운 부분집합 → 블록 배열 (한 줄짜리 `/guide/` 이미지 포함)
│   ├── crop-rect.ts          사진에서 쓸 영역 계산 (덮는 배율·밀 수 있는 범위·자를 사각형)
│   ├── trace-enhance.ts      캡처본의 숨은 워터마크 드러내기 (주변 평균 빼기 + 증폭)
│   ├── viewer-code.ts        워터마크의 보는 사람 표기 (멤버 `No.17` · 주선자 `H-8F3A2C`) 와 판독
│   └── cn.ts                 Tailwind 클래스 병합
└── server/                   서버 전용 (아래 참고)
```

모든 페이지가 `force-dynamic` 이고 요청마다 DB 를 읽는다. 그래서 멤버 화면 다섯 곳과
멤버 프로필 상세, 주선자 영역에 `loading.tsx` 를 둔다 — 모임 내비게이션은 바로 뜨고
본문만 스켈레톤이 된다. 주선자 영역은 공통 스켈레톤(제목 + 패널 둘)을 기본으로 쓰고,
모양이 크게 다른 프로필 목록·상세·고치기와 가져오기 검토만 자기 것을 둔다.
`loading.tsx` 는 하위 경로까지 감싸므로 상세 경로에 자기 것이 없으면 목록 스켈레톤이
대신 뜬다 — 목록에 스켈레톤을 둘 때는 그 아래 상세도 같이 둔다.
화면을 통째로 바꾸지 않는 왕복(모임 전환 등)은 `GlobalProgressProvider` 가 루트에서
받는다. 표시가 화면 흐름 밖에 떠 있어야 기다리는 동안 눌린 자리가 밀리지 않는다.
스켈레톤은 `aria-hidden` 이라 `LoadingLabel` 을 같이 놓아야 화면을 보지 않는 사용자에게도
「불러오는 중」이 전달된다.

정적 파일은 `apps/web/public/` 에 있다. 리포 루트 `assets/` 의 브랜드 에셋을 그대로
복사한 것이고, 파일명을 바꾸지 않아 원본과 1:1 로 대응한다.

```
apps/web/public/
├── favicon.ico               레거시 경로 (/favicon.ico 로 직접 요청된다)
├── favicon-16/32/48.png      브라우저 탭
├── favicon-180.png           apple-touch-icon
├── favicon-192/512.png       manifest 아이콘 · 홈 화면
├── site.webmanifest          홈 화면 이름·색 — app/layout.tsx 가 link 를 낸다
├── bolsaram-logo-primary.png     세로 락업 (볼사람 / BOLSARAM)
├── bolsaram-logo-horizontal.png  가로 락업 (볼사람 | BOLSARAM)
├── bolsaram-symbol.png           심볼 마크
└── guide/                    시작 가이드의 화면 사진 — `pnpm guide:screenshots` 가 만든다
```

`public/guide/` 의 사진은 손으로 찍지 않는다. `scripts/guide-screenshots.ts` 가 합성 데이터만
담은 별도 DB(`<DB 이름>_guide`)와 임시 스토리지로 빌드된 앱을 다른 포트에 띄워 찍는다 —
운영 DB 의 실제 멤버가 사진에 들어가지 않게 하기 위해서다. 화면을 바꾸면 빌드 후 다시
돌리고, `tests/docs-guide.test.ts` 가 문서와 사진이 서로 빠짐없이 맞는지 본다.

> 원본 캔버스에 여백이 비대칭으로 들어 있어서 로고는 `BrandLogo` 를 통해서만 쓴다.
> 실측한 글리프 경계를 잘라 그리고, 화면 크기에 맞는 변형(`wordmark`·`lockup`·
> `stacked`·`symbol`)을 고른다. `assets/` 를 새 버전으로 갈면 그 좌표를 다시 재야 한다.

### `server/` — 서버 전용 모듈

```
server/
├── env.ts                    환경변수 스키마 (production 은 https·기본 시크릿 금지)
├── crypto.ts                 HMAC·scrypt·랜덤 토큰·타이밍 안전 비교
├── audit.ts                  감사 로그 (민감값 제외)
├── auth/
│   ├── session.ts            서명 쿠키 + sessions 테이블 (마지막 사용 후 30일). 정지된 계정은 새 세션도 기존 세션도 막는다
│   ├── oauth.ts              주선자 로그인 = 가입 (카카오·구글, state+PKCE, 계정 잇기, 프로필 사진 가져오기, 연결된 계정 조회)
│   ├── invite.ts             초대 링크 = 멤버 로그인 (매직 링크, 해시 저장·처음 연 사람의 입장 링크)
│   ├── group-invite.ts       모임 만들기(승인 요청·거두기·승인 처리 포함)·소속·사진·초대 코드·모임장 위임/내보내기·보고 있는 모임 전환·폐쇄
│   ├── operator.ts           관리자 지정 동기화(env → DB, 기존 소속 걷어내기) · 관리자 설정(모임 만들기 승인·초대 코드 여러 번 쓰기) · 모임 만들기 요청 목록 · 주선자 목록·정지/풀기
│   ├── telegram.ts           봇 계정 연결(해시 코드, 다른 계정에서 옮겨오기) + webhook 재전송 차단
│   └── guard.ts              requireUser / requireAdmin / requireOperator / requireGroupAdmin / requireGroupOwner / requireMemberProfile
│                             (미로그인: 멤버 화면 → /enter, 주선자 화면 → /login)
├── docs/guide.ts             docs/guide/ 문서 읽기 (파일명 화이트리스트 — privacy · start · updates)
├── storage/
│   ├── local.ts              로컬/R2 private 저장소 + signed download/upload URL
│   └── watermark.ts          보는 사람 표시 합성 — 보이는 층 + 숨은 층 (멤버에게 나가는 남의 프로필 사진)
├── ai/
│   ├── types.ts              프로바이더 인터페이스 · 시스템 프롬프트(이상형 조건 포함) · PROMPT_VERSION
│   ├── mock.ts               규칙 기반 추출기 (기본, API 키 불필요)
│   ├── openai.ts             OpenAI multimodal + Structured Outputs
│   └── index.ts              AI_PROVIDER 로 선택
├── repo/                     SQL 접근 (모두 withRls 트랜잭션 안에서 호출된다)
│   ├── users.ts              내 계정 — 표시 이름·프로필 사진
│   ├── profiles.ts           Discover·상세·주선자 목록·수정
│   ├── matches.ts            신청 생성·전이·시그널 목록·연결 상대
│   ├── match-intents.ts      멤버가 낸 요청(주선자 확인 대기) — 승인해야 신청이 된다
│   ├── host-todo.ts          주선자가 처리할 일의 개수 — 홈 「오늘 할 일」과 메뉴 배지 (각 화면과 같은 범위)
│   ├── profile-images.ts     사진 추가·삭제·대표 지정 (순서와 대표 불변식)
│   ├── favorites.ts          관심 토글·목록
│   ├── hides.ts              숨기기 토글·목록 + 양방향 판정
│   ├── imports.ts            세션·에셋·추출·검토. 세션 생성·원문 수정은 같은 원문(`raw_text_key`)이 이미 있으면 409 — 웹·봇 공통, 남이 올린 것도(있다는 사실만 알림)
│   ├── recommendations.ts    AI 추천의 후보 — 보는 멤버의 탐색 풀(같은 쪽의 활성 이성, 거절·숨김 제외)
│   ├── group-chat.ts         모임 채팅 — 메시지 목록·작성·지우기, 읽은 위치·안 읽은 수
│   └── telegram.ts           봇 대화 상태 + 계정 연결 조회/해제
├── telegram/                 텔레그램 Import 채널 (Bot API 를 아는 유일한 곳)
│   ├── client.ts             Bot API 호출·파일 다운로드·webhook 서명 확인
│   ├── adapter.ts            Update → 신원 확인 → 의도 판정 → ImportSession
│   └── messages.ts           봇 응답 문구
├── chat/
│   └── broadcast.ts          채팅 변화 구독 (LISTEN 커넥션 하나 → 열린 SSE 연결들)
├── notify/                   알림 아웃박스 → 텔레그램 발송
│   ├── outbox.ts             미발송 알림 선점·기록 (owner)
│   └── dispatch.ts           발송 루프 + 기동 시 주기 스윕
├── services/import-service.ts  분석 실행 + idempotent commit
├── services/recommend-service.ts  AI 추천 — 보는 멤버에게 추천인 사람 집합·한 사람 판정 (저장된 조건끼리 견주기, AI 호출 없음)
├── views/
│   ├── profile-view.ts       공개 단계 판정·적용 + signed URL 부착
│   ├── host-profile.ts       주선자 상세·편집이 함께 쓰는 프로필 하나 읽기 (권한·공개 단계·초대)
│   └── image-url.ts          사진 하나짜리 저장 키 → 단기 signed URL (주선자·모임 사진)
└── http/
    ├── respond.ts            DomainError → HTTP status, 입력 검증
    └── context.ts            asUser / asAdmin / asMember (세션 + RLS 묶음)
```

---

## API

인증이 필요 없는 경로는 없다(`/api/auth/*` 제외). 미인증은 401, 멤버의 주선자 경로 접근은 403.

권한 열의 「주선자」는 DB 의 `ADMIN` 역할이다. 화면 경로에서 `/admin` 은 없앴지만
API 는 권한 경계를 경로에 드러내려고 `/api/admin/*` 을 유지한다.

권한 열의 「관리자」는 DB 역할이 아니다. `SEED_ADMIN_EMAIL1` 과 이메일이 같은 주선자
계정 하나이고, 인증 레이어가 기동·로그인 때 그 계정을 `operator_settings.operator_user_id`
에 맞춘다(`syncOperatorAccount`). 세션(`SessionUser.isOperator`)과 RLS(`app_is_operator()`)가
같은 칸을 읽는다. 관리자 메뉴 경로는 `requireOperator` 가 막는다. 화면 경로가 `/admin` 이
아닌 `/operator` 인 것은 「주선자」(`ADMIN`)와 섞이지 않게 하려는 것이다.

**관리자는 어느 모임에도 속하지 않고 모든 모임·프로필을 다룬다.** 표의 「그 모임
주선자」·「모임장」·「등록한 주선자」 자리를 관리자도 모두 통과한다 — 프로필 수정·삭제·
메모·초대, 「대신 둘러보기」(대행), 남의 가져오기, 모든 방의 채팅(합류 전 글 포함), 모임
설정·모임장 넘기기·내보내기·폐쇄. 판정은 DB 함수에 한 번(`app_is_operator()`), owner
커넥션 경로(`assertGroupAdmin` · `assertGroupOwner` · `readMyGroups` · 세션)에 한 번 들어 있다.
관리자가 남의 가져오기를 등록해도 프로필의 등록자는 원본을 만든 주선자다. 관리자가 만든
모임은 주선자 없이 시작한다 — 초대로 동료를 들이고 모임장을 넘긴다.

**정지된 주선자(`user_suspensions`)는 인증 레이어에서 막는다.** RLS 컨텍스트가 만들어지기
전에 걸리도록 세션 읽기(`readSession`)·새 세션(`createSession`)·텔레그램 신원
(`findTelegramIdentity`)·알림 선점(`claimPending`)이 모두 같은 테이블을 본다. 새 인증 경로를
만들면 여기에 함께 넣는다. 관리자와 멤버는 정지 대상이 아니다(DB 트리거가 한 번 더 막는다).

`/api/health` 는 예외다. 밖에서 「살아 있는가」를 물어야 하는 경로라 로그인을 요구하지
않고, 대신 답에 개인정보도 설정값도 담지 않는다(상태 두 글자뿐이다).

알림에는 엔드포인트가 없다 — 신청·수락 경로가 발송을 띄우고 기동 시 스윕이 밀린 것을 줍는다.

텔레그램 webhook 만 세션 쿠키를 쓰지 않는다. 발신자 확인은 `setWebhook` 의 `secret_token`
(요청 헤더 `X-Telegram-Bot-Api-Secret-Token`)으로 하고, 채널이 꺼져 있으면 404 를 준다.

| 경로                                      | 메서드              | 권한              | 용도                                 |
| ----------------------------------------- | ------------------- | ----------------- | ------------------------------------ |
| `/api/auth/oauth/[provider]/start`        | GET                 | –                 | 소셜 로그인 시작 (제공자로 302)      |
| `/api/auth/oauth/[provider]/callback`     | GET                 | –                 | 소셜 로그인 완료 = 가입·세션 생성    |
| `/api/auth/logout`                        | POST                | –                 | 세션 폐기                            |
| `/api/claim`                              | POST                | **초대 토큰**     | 멤버 로그인 (매직 링크) + 최초 계정 생성 |
| `/api/profiles`                           | GET                 | 멤버              | Discover 목록 (필터·커서, 카드마다 AI 추천 여부, `ai=1` 이면 AI 추천만) |
| `/api/profiles/[id]`                      | GET / PATCH / DELETE | 멤버 / 주선자 / 등록한 주선자 | 상세 조회 / 내용 수정 / 삭제(원본·멤버 계정·파일 포함) |
| `/api/profiles/[id]/status`               | PATCH               | 주선자            | 활성·비활성 전환                     |
| `/api/profiles/[id]/memo`                 | PUT                 | 등록한 주선자     | 나만 보는 메모 저장 (빈 글이면 삭제) |
| `/api/profiles/[id]/bump`                 | POST                | 등록한 주선자     | 목록 맨 앞으로 끌어올리기 (활성만, 24시간에 한 번) |
| `/api/match-requests`                     | GET / POST          | 멤버(프로필 필요) | 시그널 목록 / 소개 신청              |
| `/api/match-requests/[id]/[action]`       | POST                | 당사자            | accept · reject · cancel             |
| `/api/admin/profiles`                     | GET                 | 주선자            | 목록 조건에 맞는 사람 수 (조건 시트의 「N명 보기」) |
| `/api/admin/match-requests/[id]/[action]` | POST                | 주선자            | 당사자 대신 accept · reject · cancel · close |
| `/api/admin/me`                           | PATCH               | 주선자            | 내 표시 이름 바꾸기                  |
| `/api/admin/me/avatar`                    | POST / DELETE       | 주선자            | 내 프로필 사진 올리기(슬롯·확정) / 지우기 |
| `/api/admin/acting`                       | POST / DELETE       | 주선자            | 대행 시작 / 종료 (고칠 수 있는 프로필) |
| `/api/admin/match-intents/[id]/[action]`  | POST                | 주선자            | 멤버 요청 approve · decline          |
| `/api/favorites`                          | GET / POST / DELETE | 멤버              | 관심 목록·토글                       |
| `/api/hides`                              | GET / POST / DELETE | 멤버(프로필 필요) | 숨긴 사람 목록·토글                  |
| `/api/admin/invites`                      | POST                | 주선자            | 초대 링크 · 입장코드 발급 (같은 토큰) |
| `/api/imports`                            | GET / POST          | 주선자            | 가져오기 목록(현재 방, 기본 등록 전 · `done=1` 등록됨) / 세션 생성 + 업로드 슬롯 (`groupId` 필수) |
| `/api/imports/[id]`                       | GET / DELETE        | 주선자            | 원본·추출 결과 / 세션 삭제           |
| `/api/imports/[id]/assets`                | POST / DELETE       | 주선자            | 업로드 확정·슬롯 추가 / 제거         |
| `/api/imports/[id]/text`                  | PATCH               | 주선자            | 원문 저장                            |
| `/api/imports/[id]/group`                 | PATCH               | 주선자            | 등록될 모임 바꾸기 (`null` = 전체공개) |
| `/api/imports/[id]/analyze`               | POST                | 주선자            | AI 추출 실행                         |
| `/api/imports/[id]/extraction`            | PATCH               | 주선자            | 검토 결과 저장                       |
| `/api/imports/[id]/commit`                | POST                | 주선자            | 프로필 생성 (idempotent)             |
| `/api/admin/groups`                       | GET / POST          | 주선자            | 속한 모임들 + 보고 있는 모임 + 내 요청 / 모임 만들기 (승인이 켜져 있으면 요청만 남기고 202) |
| `/api/admin/groups/requests/[id]`         | DELETE              | 요청한 주선자     | 기다리는 모임 만들기 요청 거두기     |
| `/api/admin/groups/join`                  | POST                | 주선자            | 초대 코드로 모임 합류                |
| `/api/admin/groups/active`                | PUT                 | 주선자            | 보고 있는 모임 전환 (`null` = 전체공개) |
| `/api/admin/groups/[id]`                  | PATCH / DELETE      | 그 모임 주선자    | 이름·설명 수정 / 모임 나가기         |
| `/api/admin/groups/[id]/close`            | DELETE              | **모임장**        | 모임 폐쇄 (비어 있을 때만)           |
| `/api/admin/groups/[id]/image`            | POST / DELETE       | 그 모임 주선자    | 모임 사진 올리기(슬롯·확정) / 지우기 |
| `/api/admin/groups/[id]/invite`           | POST                | 그 모임 주선자    | 동료 주선자 초대 코드 발급 (1회용·여러 번은 관리자 설정, 응답 `reusable`) |
| `/api/admin/groups/[id]/admins/[userId]`  | PATCH / DELETE      | **모임장**        | 모임장 넘기기 / 주선자 내보내기      |
| `/api/admin/groups/[id]/messages`         | GET / POST          | 그 모임 주선자    | 채팅 읽기(`before`·`after`) / 쓰기   |
| `/api/admin/groups/[id]/messages/[messageId]` | DELETE          | 쓴 사람           | 내 메시지 지우기 (본문만 사라진다)   |
| `/api/admin/groups/[id]/mentions`         | GET                 | 그 모임 주선자    | 채팅 태그 후보 — `kind=host` 그 모임 주선자(나 제외) · `kind=member` 그 모임 멤버(이름 없이) |
| `/api/admin/groups/[id]/chat`             | GET / PATCH         | 그 모임 주선자    | 읽은 위치·텔레그램 알림 설정         |
| `/api/admin/chat`                         | GET                 | 주선자            | 모임별 안 읽은 채팅 수 (첫 값·재동기화) |
| `/api/admin/chat/stream`                  | GET (SSE)           | 주선자            | 속한 모든 방의 새 글·지움을 밀어준다 |
| `/api/admin/telegram`                     | GET / POST / PATCH / DELETE | 주선자    | 봇 연결 상태 / 연결 코드 발급 / 담을 모임 변경 / 해제 |
| `/api/admin/trace`                        | GET                 | 주선자            | 워터마크의 주선자 코드 → 누구인지 (나·같은 모임 동료까지) |
| `/api/operator/settings`                  | GET / PUT           | **관리자**        | 관리자 설정 — 모임 만들기 승인 · 초대 코드 여러 번 쓰기 켜기·끄기 (보낸 항목만) |
| `/api/operator/group-requests/[id]/[action]` | POST             | **관리자**        | 모임 만들기 요청 approve · reject (승인하면 그때 모임 생성) |
| `/api/operator/hosts/[id]/suspension`     | PUT / DELETE        | **관리자**        | 주선자 정지(세션 폐기·등록 프로필 비활성·요청 거절·초대 코드 회수) · 정지 풀기 |
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
확정 단계에서 그 키가 **올린 사람의 것인지**(`avatar/<userId>/`·`group/<groupId>/`·
`profile/<profileId>/`) 다시 본다.
다운로드는 서명 + **로그인**을 함께 요구한다. URL 이 유출돼도 외부인은 쓸 수 없다.

**프로필 사진에는 보는 사람 표시를 두 겹으로 합성한다**(`storage/watermark.ts`).
웹에서는 캡처를 막을 수 없으므로 캡처본에 보는 사람과 서울 날짜가 남게 한다. 보는 사람
표기는 `lib/viewer-code.ts` 하나가 정한다 — 멤버는 공개 번호 `No.17`, 주선자는 계정 id
앞 여섯 자리 `H-8F3A2C`(주선자에게는 공개 번호가 없다).

| 층 | 모양 | 역할 |
| -- | ---- | ---- |
| 보이는 층 | `BOLSARAM No.17 26.10.13` 작은 글씨, 넓은 간격, 아주 옅게 | 표시가 있다는 것 자체로 억제 |
| 숨은 층 | `No.17 261013` 굵은 큰 글씨, 촘촘히, 밝기 2 단계만 낮춤 | 잘라내기·지우기·재압축 뒤에도 판독 |

숨은 층은 맨눈으로 보이지 않는다. 주선자 화면 `/profiles/trace` 가 캡처본에서 주변 평균
밝기를 빼고 차이를 키워 드러낸다(`lib/trace-enhance.ts`). **판독은 브라우저 안에서만 한다** —
유출본을 서버로 받지 않는다. 읽어 낸 주선자 코드만 `/api/admin/trace` 로 보내 누구인지
묻고, 찾는 범위는 RLS(`users_self_select`)대로 나 자신과 같은 모임 동료까지다.
CSS 로 덮으면 걷어낼 수 있어 `/api/files` 가 픽셀에 직접 넣고 JPEG 로 다시 내보낸다
(원본 메타데이터는 남지 않는다). 판정은 요청한 세션 기준이다 — URL 이 아니라 연 사람의
표기가 찍힌다. 주선자는 화면 어디서 보든(가져오기 원본·대행 포함) 주선자 코드가 찍히고,
멤버는 자기 사진만 원본이다. 주선자·모임 사진은 표시 없이 나간다.
sharp 가 디코딩하지 못하는 HEIC 는 표시 없이 원본이 나간다.
멤버·주선자 화면은 이와 별개로 사진의 길게 눌러 저장·우클릭·드래그를 막는다(`components/ui/photo-guard.tsx`
와 `globals.css`). 이건 원본을 손쉽게 가져가는 길만 닫는 것이고 캡처 방지가 아니다.

주선자 프로필 사진과 모임 사진도 같은 저장소에 있다. 사진이 **없는 것이 정상**이며
그때 화면은 이름의 앞글자를 그린다(`components/ui/avatar.tsx`). 주선자 사진은 카카오·구글
계정을 처음 연결할 때 한 번 받아 두고, 그 뒤로는 본인이 정한다.
시드가 만든 SVG 는 CSP `sandbox` 로 스크립트를 무력화해 서빙한다(업로드 허용 목록에는 없다).

### Import

`세션 생성 → signed 업로드 → 확정 → 원문 → 분석 → 검토 → commit`.
commit 은 `idempotency_key` 를 조건부로 선점해 같은 세션에서 프로필이 두 개 생기지 않게 한다.
분석은 프로바이더 호출이 길어 RLS 트랜잭션 **밖에서** 하고 앞뒤로만 DB 를 만진다.

### AI 추천

```
가져오기 분석    → AI 추출이 다른 항목과 함께 idealCriteria 를 뽑는다 (같은 호출)
검토·등록        → 주선자가 고치고, commit 이 profiles.ideal_criteria 에 저장
내용 고치기      → 주선자가 직접 고친다 (AI 를 다시 부르지 않는다)
멤버 탐색        → 보는 멤버 + 그 탐색 풀 → domain rankRecommendations → 카드의 aiRecommended
                   ai=1 이면 같은 집합으로 목록·총 인원·커서를 좁힌다
멤버 상세        → 그 한 사람만 같은 규칙으로 견주고 이유를 싣는다 (aiMatchFor — 이상형 / 공통점)
```

**표시를 고를 때 AI 를 부르지 않는다.** 조건은 프로필 항목이고 견주기는 규칙이라 요청마다
바로 계산한다. 후보 프로필을 모델에 보내 어울리는지 묻지 않는다. 보는 멤버의 조건이 비어
있으면 상대의 이상형에 그 멤버가 맞는 사람을 고른다. 판정은 보는 사람의 프로필이 정하므로
대행 중에도 그 멤버 기준이고, 멤버 프로필이 없는 주선자 세션에는 표시가 없다.
이상형 조건 자체는 공개 단계(`projectProfile`)가 모르는 칸이라 멤버 화면으로 나가지 않는다 —
멤버에게 가는 것은 상대마다의 참·거짓 하나뿐이다. 이상형 글만 고치고 조건을 안 고치면
둘이 어긋난다 — 편집 화면이 함께 고치라고 안내한다.

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
분석 결과 메시지의 버튼(성별 · 등록)도 웹과 같은 `applyExtractionReview` · `commitSession` 을
부른다. 등록 버튼은 세션에서 만든 idempotency 키를 쓰므로 두 번 눌러도 프로필은 하나다.

대화 하나는 프로필 하나다. 글을 받은 뒤 오는 사진이나 등록된 Import 에 들어오는 입력은
이전 대화를 `COMPLETED` 로 닫고 새 대화로 받는다(domain 의 `conversationRollover`).

owner 커넥션은 신원 확인 구간에서만 쓴다 — webhook 에는 세션 쿠키가 없어 RLS 컨텍스트를
만들 수 없기 때문이며, 신원이 정해진 뒤에는 일반 주선자 요청과 완전히 같다.

**담기는 모임은 연결 설정에 붙어 있다**(`telegram_connections.upload_group_id`). 화면 위쪽에서
보고 있는 채널과 별개의 값이며, 계정 설정(`/account`)의 텔레그램 연결 패널과 봇의 `/room` 이
같은 값을 바꾼다. 「가져오기」는 지금 담기는 방을 읽기 전용으로만 보여준다. 카카오톡에서 넘길 때는 웹을 보고 있지 않으므로 담을 곳이 화면을 따라 움직이지 않는다.

### 알림

```
멤버의 신청·수락 (RLS 트랜잭션)
  → DB 트리거가 notifications 에 행 추가      담당 주선자 = app_profile_admins()
  → scheduleDispatch()                        응답을 기다리지 않고 띄운다
  → 디스패처가 선점(attempts+1) → 텔레그램 → sent_at
```

**요청 트랜잭션 안에서 텔레그램을 호출하지 않는다.** 멤버 컨텍스트에서는 주선자의
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

## Cloudflare R2

설정 및 전환 방법은 [R2 운영 안내](../../docs/r2-storage.md)를 참고합니다.
