# 볼사람(Bolsaram) 서비스 설계 문서 v2

> 좋은 사람을, 좋은 방식으로.

## 1. 제품 정의

볼사람은 주선자가 검증해 등록한 사람들만 참여하는 비공개 소개팅
서비스다. 핵심 사용자 흐름은
`프로필 탐색/필터 → 상세 → 마음 보내기 → 상대 수락 → 주선자 연결`이고,
핵심 운영 흐름은 `카카오톡 → 모바일 공유 → AI 구조화 → 검토 → 게시`다.

### 제품 원칙

-   등록은 카카오톡보다 번거롭지 않아야 한다.
-   사용자는 추천보다 직접 탐색/필터/신청한다.
-   리스트는 빠르고 기능적이며, 상세/신청 순간은 연애 예능처럼
    감성적으로 연출한다.
-   개인정보는 단계적으로 공개한다.
-   AI는 추천보다 프로필 입력 자동화에 우선 사용한다.
-   관리자 UX는 CRM처럼 효율적으로 만든다.

## 2. 역할

### ADMIN / MATCHMAKER

카톡 프로필 가져오기, AI 결과 검토, 프로필/상태 관리, 초대, 신청 관리,
연결 완료 처리. \### MEMBER 프로필 탐색/필터, 관심 저장, 소개 신청, 받은
신청 수락/거절, 내 프로필/시그널 확인.

## 3. 가장 중요한 요구사항: 저장 없는 카카오톡 Import

목표 UX:
`카카오톡에서 프로필 이미지 여러 장 + 글 선택 → 공유 → 볼사람 → Import → AI 분석 → 검토 → 등록`

웹/PWA만으로 해결한다고 가정하지 않는다. 얇은 모바일 앱을 두고 iOS Share
Extension과 Android Share Intent를 지원한다.

카카오톡/OS 조합에 따라 이미지+텍스트가 항상 동시에 전달된다고 가정하면
안 된다. 실제 기기 spike를 가장 먼저 수행한다.

Fallback: 1. 이미지+텍스트: 즉시 분석 2. 이미지만: 텍스트 붙여넣기 3.
텍스트만: 사진 추가 4. 스크린샷: Vision 분석 5. 직접 업로드

Import는 즉시 Profile로 만들지 않고 Inbox를 거친다.

## 4. 핵심 사용자 플로우

### 등록

공유 수신 → ImportSession → 여러 ImportAsset 업로드 → rawText 저장 → AI
Extraction → confidence 표시 → 관리자 수정 → commit →
Profile/ProfileImage.

### 가입/Claim

관리자가 프로필 등록 → 초대 링크 → 로그인 → 본인 프로필 확인 → Claim →
User와 Profile 연결.

### 탐색

Discover → 성별/나이/키/지역/직업군/종교/흡연/음주 필터 → 카드 → 상세 →
관심 또는 신청.

### 신청/수락

`REQUESTED → ACCEPTED → INTRODUCED → CLOSED`. 분기 상태: `REJECTED`,
`CANCELED`. 자기 자신 신청 및 활성 중복 신청은 금지한다.

## 5. 정보 공개

LIST: 익명 코드(#17), 대표 사진, 출생연도, 키, 직업군, 넓은 지역.
DETAIL: 사진, 직업/회사, 학력, 지역, 종교, MBTI, 흡연/음주, 취미, 소개,
이상형. INTRODUCED: 정책에 따라 이름/연락 방식 공개.

## 6. 화면

### Member

-   `/discover`: 카드 그리드, 성별 탭, 필터 bottom sheet
-   `/discover/[id]`: 큰 사진, ABOUT, 취미, IDEAL TYPE, 관심, 소개 신청
-   `/signals`: 받은/보낸/연결된 시그널
-   `/favorites`
-   `/me`

### Admin

-   `/admin`: KPI
-   `/admin/imports`: Import Inbox
-   `/admin/imports/[id]`: 원본/AI 결과/수정/commit
-   `/admin/profiles`: 검색/필터/상태 관리
-   `/admin/requests`: 신청/수락/연결
-   `/admin/members`: 초대/가입/Claim

## 7. 아키텍처

``` text
KakaoTalk
  ↓ OS Share
Bolsaram Mobile (Expo/RN)
  ├ iOS Share Extension
  └ Android Share Intent
  ↓
Import API
  ↓
Supabase Storage + PostgreSQL
  ↓
OpenAI Structured Extraction
  ↓
Admin Review
  ↓
Profile

Member Web (Next.js) ↔ API/Supabase ↔ MatchRequest
```

## 8. 기술 스택

-   Monorepo: pnpm workspace, 필요 시 Turborepo
-   Web: Next.js 16+, App Router, TypeScript strict, Tailwind,
    shadcn/ui, Zod
-   Mobile: Expo/React Native, Expo Router, 필요 시 Swift/Kotlin native
    target
-   Backend: Next.js Route Handlers/Server Actions + Supabase
-   Data: PostgreSQL, Supabase Auth/Storage/RLS
-   AI: OpenAI multimodal + Structured Outputs
-   Storage: private bucket + short-lived signed URL

## 9. 데이터 모델

### User

`id, role(ADMIN|MEMBER), phone?, displayName?, createdAt, updatedAt`

### Profile

`id, userId?, publicCode, gender, birthYear, height, jobTitle, jobCategory, company, education, residenceRegion, workplaceRegion, religion, mbti, smoking, drinking, hobbies[], bio, idealTypeText, status, visibility, createdAt, updatedAt`

Profile status: `ACTIVE | MATCHING | PAUSED | INACTIVE | ARCHIVED`.

### ProfileImage

`id, profileId, storageKey, sortOrder, isPrimary, createdAt`

### ImportSession

`id, createdBy, source, status, rawText?, errorMessage?, createdAt, updatedAt`
source: `KAKAO_SHARE | MANUAL_UPLOAD | SCREENSHOT | TEXT` status:
`RECEIVED | UPLOADING | ANALYZING | REVIEW_REQUIRED | READY | IMPORTED | FAILED`

### ImportAsset

`id, importSessionId, type, storageKey, originalFilename?, mimeType, sortOrder`

### ImportExtraction

`id, importSessionId, fieldsJson, confidenceJson, rawModelOutput, model, promptVersion`

### MatchRequest

`id, requesterProfileId, targetProfileId, status, requestedAt, respondedAt?, introducedAt?, closedAt?`

### Favorite

`userId, profileId, createdAt`

### Invite

`id, profileId, tokenHash, expiresAt, claimedAt?, createdBy`

### AuditLog

`id, actorUserId, action, entityType, entityId, metadata, createdAt`

## 10. API

Imports: - `POST /api/imports` - `POST /api/imports/:id/assets` -
`PATCH /api/imports/:id/text` - `POST /api/imports/:id/analyze` -
`GET /api/imports/:id` - `PATCH /api/imports/:id/extraction` -
`POST /api/imports/:id/commit`

Profiles: - `GET /api/profiles` - `GET /api/profiles/:id` -
`PATCH /api/profiles/:id` - `PATCH /api/profiles/:id/status`

Signals: - `POST /api/match-requests` -
`GET /api/match-requests?direction=incoming|outgoing` -
`POST /api/match-requests/:id/accept|reject|cancel` -
`POST /api/admin/match-requests/:id/introduce`

Favorites/Invite도 별도 endpoint로 제공한다. 이미지 업로드는 가능하면
signed direct upload를 사용한다.

## 11. AI Extraction

텍스트가 있으면 원문을 우선 source로 사용하고 스크린샷/이미지는
보조한다. 명시되지 않은 값은 추론하지 않고 `null`로 반환한다. 각 필드
confidence를 별도 저장한다. AI 결과는 자동 공개하지 않는다.

예시 필드:
`gender, birthYear, height, jobTitle, jobCategory, company, education, residenceRegion, religion, mbti, smoking, drinking, hobbies, bio, idealTypeText`.

## 12. 보안/개인정보

-   private storage + signed URL
-   RLS 필수
-   ADMIN 서버 권한 검증
-   invite token hash 저장
-   rate limit/audit log
-   검색엔진 index 금지
-   실제 인물 데이터를 seed/test fixture로 사용 금지
-   production log에 raw profile/사진 URL 최소화
-   Import 원본 보관/삭제 정책
-   동의, 탈퇴, 삭제 정책
-   EXIF 제거 검토

## 13. 브랜드/UI

서비스명: **볼사람**, 영문: **Bolsaram**. 톤: `Private Matching Club`.
카피: `좋은 사람을, 좋은 방식으로.`

사용자 화면은 특정 방송 디자인을 복제하지 않고 큰 인물 사진, 여백, warm
ivory, muted rose/burgundy, serif display + clean sans, 절제된 모션을
사용한다. 과도한 하트와 Tinder식 swipe를 피한다. 관리자는 Linear/Notion
계열의 효율적인 CRM 톤으로 분리한다.

## 14. 프로젝트 구조

``` text
bolsaram/
├ apps/
│ ├ web/
│ └ mobile/
├ packages/
│ ├ domain/
│ ├ schemas/
│ ├ config/
│ └ ui-tokens/
├ supabase/migrations/
├ docs/
└ README.md
```

## 15. 구현 순서

0.  **Share Spike**: 실제 iOS/Android + 카카오톡에서
    1장/여러장/텍스트/이미지+텍스트 검증
1.  Foundation/Auth/RLS
2.  Schema/private image
3.  Discover/filter/detail/favorite
4.  MatchRequest state machine
5.  Admin
6.  Import Inbox + AI
7.  Mobile Share Extension/Intent
8.  Invite/Claim
9.  Security/E2E/production hardening

Share Spike가 끝나기 전에 특정 share 라이브러리를 확정하지 않는다.

## 16. MVP 완료 조건

실제 기기에서
`카카오톡 여러 이미지 공유 → 저장 없이 Import → 텍스트 fallback → AI 구조화 → 관리자 게시 → 회원 필터 탐색 → 신청 → 상대 수락 → 관리자 연결`이
끝까지 동작하고, 권한 없는 사용자가 프로필/이미지를 볼 수 없어야 한다.
