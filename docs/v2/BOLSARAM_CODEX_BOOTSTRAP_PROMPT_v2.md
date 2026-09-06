# 볼사람(Bolsaram) Codex Bootstrap Prompt v2

너는 이 저장소의 시니어 풀스택/모바일 엔지니어다.

먼저 `BOLSARAM_SERVICE_DESIGN_v2.md`와
`BOLSARAM_MOBILE_SHARE_IMPORT_GUIDE_v2.md`를 읽고 볼사람 MVP를
단계적으로 구현하라.

## 제품 핵심

회원:
`프로필 리스트 → 필터 → 상세 → 마음 보내기 → 상대 수락 → 주선자 연결`.
운영자:
`카카오톡 프로필 → OS 공유 → Import Inbox → AI 추출 → 검토 → 게시`.

최우선 요구사항: **주선자가 모바일 카카오톡에서 받은 프로필 이미지 여러
장과 프로필 글을 사진 앱에 저장하지 않고 볼사람으로 바로 가져올 수
있어야 한다.**

iOS Share Extension과 Android Share Intent를 지원하되 카카오톡이
이미지+텍스트를 항상 동시에 전달한다고 추측하지 말고 fallback을
구현한다.

## 기술

-   pnpm workspace, TypeScript strict
-   Next.js 16+ App Router
-   Expo/React Native + Expo Router
-   Supabase PostgreSQL/Auth/Storage/RLS
-   Tailwind + shadcn/ui + Zod
-   OpenAI multimodal + Structured Outputs
-   private storage + signed URLs

특정 Expo share 라이브러리를 먼저 고정하지 마라. Share Spike 후 현재
SDK에서 검증 가능한 방법을 선택하고 필요 시 prebuild/Swift/Kotlin 코드를
허용한다.

## 브랜드

-   볼사람 / Bolsaram
-   `좋은 사람을, 좋은 방식으로.`
-   사용자: warm ivory, muted rose/burgundy, 큰 사진/여백, serif
    display + clean sans, 절제된 연애 프로그램 분위기
-   관리자: 감성보다 CRM 효율
-   특정 방송 프로그램 UI/로고를 복제하지 말 것
-   Tinder clone으로 만들지 말 것

`BOLSARAM_UI_CONCEPT_v2.png`가 있으면 분위기만 참고한다.

## 구현 순서

### 0. Repository audit

기존 코드를 먼저 읽고 conventions를 보존한다.

### 1. Share Spike

`docs/share-spike-plan.md`를 만들고 iOS/Android에서 사진
1장/여러장/텍스트/사진+텍스트를 실제 기기로 검증할 계획과 native
entrypoint, URI lifetime, retry를 문서화한다.

공통 모델:

``` ts
type IncomingSharePayload = {
  text?: string;
  assets: { uri:string; mimeType?:string; name?:string; order:number }[];
};
```

실제 카카오톡 동작을 코드만으로 확정했다고 주장하지 않는다.

### 2. Foundation

workspace, web/mobile/shared package, env example, lint/typecheck/test,
design token.

### 3. Supabase

설계문서의
User/Profile/ProfileImage/ImportSession/ImportAsset/ImportExtraction/MatchRequest/Favorite/Invite/AuditLog
migration, index, constraints, RLS를 구현한다. synthetic seed만
사용한다.

### 4. Auth/Roles

MEMBER/ADMIN, server authorization, admin route guard.

### 5. Member UI

mobile-first Discover, filter bottom sheet, profile detail, favorite,
Signals, Profile. Desktop은 3\~4열로 확장.

### 6. Match domain

create/accept/reject/cancel/introduce/close 상태 전이를 domain layer에
중앙화하고 자기 자신/중복/race condition을 막는다.

### 7. Admin

dashboard, profiles, requests, members, Import Inbox.

### 8. Import API

create session, multi asset direct upload, raw text, analyze, review,
idempotent commit.

### 9. AI extraction

Zod/JSON schema를 single source로 사용. 추측 금지, unknown=null,
confidence 반환, validation, low-confidence 표시, 자동 게시 금지.
provider abstraction으로 mock 가능하게 한다.

### 10. Mobile Share

share target → preview → multi-image/text → upload progress/retry →
missing-text fallback → review deep link. Extension에서 AI 완료를 오래
기다리지 않는다.

### 11. Invite/Claim

expiring hashed token, login, claim, replay 방지.

### 12. Tests

profile filter, match transition, auth, import normalization, extraction
validation, commit idempotency, duplicate request. 가능하면 Playwright로
`Discover → detail → request → target accept`.

## 품질 규칙

`any` 남발 금지. secret/service-role client 노출 금지. private image
permanent URL 금지. 실제 개인정보 fixture 금지. raw AI JSON은 반드시
validation. 에러를 삼키지 않는다. TODO에는 이유/완료 조건을 쓴다.

## 첫 실행

1.  저장소 구조 확인
2.  두 설계 문서 읽기
3.  기존 구현과 충돌 확인
4.  `docs/implementation-plan.md` 작성
5.  Share Spike부터 시작
6.  foundation/schema 진행
7.  각 phase마다 typecheck/lint/test
8.  변경 파일, 검증 결과, 다음 단계, 실제 기기 검증 항목을 요약

합리적인 기본값으로 진행하되 외부 앱인 카카오톡의 공유 payload를 추측해
확정하지 마라.
