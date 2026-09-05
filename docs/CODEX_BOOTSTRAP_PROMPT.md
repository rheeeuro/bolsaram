# Codex 시작 프롬프트

아래 프롬프트를 프로젝트 루트에서 Codex에 전달한다.

---

당신은 시니어 풀스택 엔지니어이자 프로덕트 엔지니어입니다.

현재 저장소에 있는 `PRIVATE_MATCHING_SERVICE_DESIGN.md`를 **이 프로젝트의 단일 기준 문서(Single Source of Truth)** 로 사용해서 MVP를 구현해주세요.

## 목표

카카오톡에서 관리하던 소개팅 프로필을 웹 서비스로 옮기고, 초대받은 사용자가 프로필 목록을 필터링하여 직접 소개 신청을 보내고 상대가 수락하면 연결되는 **비공개 소개팅 마켓**을 만듭니다.

일반 사용자 UI는 하트시그널/솔로지옥처럼 연애 프로그램에 참가하는 느낌의 감성적인 모바일 경험으로 구성하고, 관리자 UI는 효율적인 CRM으로 구성합니다.

## 기술 스택

반드시 다음을 사용하세요.

- Next.js 16+ App Router
- TypeScript strict mode
- Tailwind CSS
- shadcn/ui
- Supabase
  - PostgreSQL
  - Auth
  - Private Storage
  - RLS
- Zod
- React Hook Form
- Framer Motion
- OpenAI API (AI Profile Import)

패키지 매니저는 `pnpm`을 사용합니다.

## 개발 원칙

1. 먼저 저장소 구조와 현재 코드를 확인합니다.
2. 설계문서를 읽고 구현 계획을 짧게 작성합니다.
3. 불필요하게 거대한 추상화나 microservice 구조를 만들지 않습니다.
4. MVP는 Next.js 단일 애플리케이션으로 구현합니다.
5. Client Component는 꼭 필요한 곳에만 사용합니다.
6. 데이터 fetch는 가능한 한 Server Component/Server Action 중심으로 구현합니다.
7. 모든 mutation은 서버에서 인증/인가를 다시 검증합니다.
8. TypeScript `any` 사용을 피합니다.
9. 개인정보가 로그에 노출되지 않도록 합니다.
10. 이미지 파일은 절대 public bucket에 저장하지 않습니다.
11. 모바일 UX를 우선 구현합니다.
12. 관리자 화면과 사용자 화면의 디자인 언어를 분리합니다.

## 먼저 수행할 작업

### Step 1. Foundation

다음을 구현하세요.

- Next.js 프로젝트 구성 확인 또는 초기화
- Tailwind
- shadcn/ui
- `.env.example`
- Supabase browser/server client
- 인증 유틸리티
- Admin/Member route guard
- 공통 디자인 token
- 기본 app shell

`.env.example`에는 최소 다음 키를 포함합니다.

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Step 2. Database

`supabase/migrations` 아래 SQL migration을 생성하세요.

필요 테이블:

- users 또는 profiles와 연결되는 auth metadata 구조
- profiles
- profile_images
- profile_sources
- favorites
- match_requests
- invites

필요 enum/status도 migration에서 관리하세요.

다음을 반드시 적용하세요.

- foreign key
- unique constraint
- index
- RLS
- created_at / updated_at
- 자기 자신에게 MatchRequest 생성 금지
- 동일 pair에 진행 중 요청 중복 방지

DB 정책은 기능 구현 전에 먼저 작성하세요.

### Step 3. Seed Data

개발용 seed script를 추가하세요.

최소:

- admin 1명
- 남성 프로필 8명
- 여성 프로필 8명
- 다양한 출생연도/키/직업/지역/종교 데이터

실제 사람 개인정보나 인터넷에서 가져온 실명/사진은 사용하지 마세요.
사진이 필요하면 placeholder 이미지 또는 CSS gradient를 사용하세요.

### Step 4. Member UI

다음 페이지를 우선 구현합니다.

#### `/discover`

- mobile-first
- 2 column profile card grid
- 성별 tab
- filter button
- filter bottom sheet
- 필터 결과 개수 표시
- favorite button

카드에는 다음만 표시합니다.

- 대표 이미지
- publicCode (#17 형태)
- birthYear
- height
- jobCategory 또는 jobTitle
- location

#### `/profiles/[id]`

- 큰 대표 이미지
- 익명 ID
- 출생연도 / 키 / 지역
- 직업 / 회사 / 학교 / 종교 / MBTI
- 취미
- 자기소개
- 이상형
- 관심 담기
- 소개 신청하기

디자인은 제공된 컨셉 이미지와 설계문서 방향을 참고하되 그대로 복사하지 마세요.

### Step 5. Favorite

- optimistic UX
- 로그인 사용자 기준 저장
- 중복 방지
- `/favorites`

### Step 6. Match Request

소개 신청 UX를 구현하세요.

상태:

```txt
REQUESTED
ACCEPTED
REJECTED
CANCELED
INTRODUCED
CLOSED
```

필요 기능:

- 소개 신청
- 확인 모달
- 받은 시그널
- 보낸 시그널
- 수락
- 거절
- 취소

화면:

- `/signals`
- `/signals/[id]`

Copy tone:

- `소개 신청`이라는 기술 표현보다는 `마음 보내기`
- REQUESTED → `답을 기다리는 중`
- ACCEPTED → `서로의 마음이 닿았어요`

단, DB/API에서는 명확한 기술 용어를 사용하세요.

### Step 7. Match Success

상호 수락 후 보여줄 화면을 만드세요.

- subtle animation
- `IT'S A MATCH`
- `서로의 마음이 닿았습니다.`
- `주선자가 두 분을 연결해드릴게요.`

과도한 confetti는 사용하지 마세요.

### Step 8. Admin

`/admin` 아래 구현합니다.

- dashboard
- profiles
- match-requests
- members

Admin UI는 감성 UI가 아니라 Linear/Notion 스타일의 고밀도 관리화면으로 만드세요.

`/admin/profiles` 기능:

- table
- search
- status filter
- create
- edit
- archive
- invite 생성

### Step 9. AI Profile Import

관리자 전용 `/admin/profiles/import` 페이지를 만드세요.

지원 입력:

- screenshot multiple upload
- raw profile images
- optional pasted text

Flow:

1. 파일 업로드
2. Private Storage 저장
3. OpenAI Vision 호출
4. Structured JSON 반환
5. Zod 검증
6. editable preview form
7. 관리자 확인
8. Profile 저장

AI는 확실하지 않은 필드를 임의로 채우지 말고 `null`로 반환하도록 하세요.

OpenAI 호출 로직은 `src/lib/openai` 또는 `src/features/profile-import`에 격리합니다.

AI response schema에는 최소 다음을 포함하세요.

```ts
{
  gender,
  birthYear,
  height,
  jobTitle,
  jobCategory,
  company,
  education,
  location,
  religion,
  mbti,
  smoking,
  drinking,
  hobbies,
  bio,
  idealTypeText,
  confidence
}
```

### Step 10. Invite / Claim

`/invite/[token]`

Flow:

- token 검증
- 로그인
- 연결될 프로필 Preview
- `이 프로필이 회원님의 프로필인가요?`
- 확인
- profile.user_id 연결
- invite USED 처리

Invite token은 DB에 평문으로 저장하지 마세요.

## 디자인 요구사항

### Member

키워드:

- Korean dating reality show
- private matching club
- editorial
- understated romantic
- cinematic
- warm ivory
- burgundy
- portrait-driven

컬러:

```txt
background  #F6F1EA
surface     #FFFDF9
text        #201D1D
secondary   #77706C
primary     #9B2C3D
accent      #D96C75
border      #E8E0D8
```

큰 사진과 여백을 적극적으로 사용하세요.
정보는 리스트에서 최소화하고 상세 화면에서 점진적으로 공개합니다.

### Admin

- white/neutral background
- compact table
- strong information density
- minimal animation

## Responsive

Primary viewport:

```txt
390 x 844
```

데스크톱에서는:

- Discover 3~4열 grid
- Profile detail max-width 적용
- Admin은 full-width dashboard

## Testing

최소 다음을 추가하세요.

- 핵심 domain validation unit test
- MatchRequest 생성 규칙 test
- invite token validation test
- AI extraction Zod schema test

가능하면 Playwright로 아래 happy path도 추가하세요.

```txt
login
→ discover
→ profile detail
→ send signal
→ target accepts
→ match success
```

## 작업 방식

한 번에 전체 코드를 무리하게 생성하지 말고 아래 순서로 진행하세요.

1. 현재 상태 분석
2. 구현 계획
3. Foundation
4. DB + RLS
5. Seed
6. Member browse UI
7. Match flow
8. Admin
9. AI import
10. Invite claim
11. Test
12. Polish

각 단계가 끝날 때마다:

- 변경 파일
- 구현 내용
- 실행/검증 방법
- 남은 TODO

를 짧게 보고하세요.

막히는 부분이 없다면 매 단계마다 사용자 확인을 기다리지 말고 계속 진행하세요.

## 품질 기준

- `pnpm lint` 통과
- `pnpm typecheck` 통과
- 테스트 통과
- mobile layout 깨짐 없음
- secret이 client bundle에 포함되지 않음
- signed URL을 제외한 private 이미지 public exposure 없음
- RLS 정책 적용
- AI 실패 시 사용자가 재시도할 수 있음
- 빈 상태 / 로딩 / 오류 상태 포함

이제 먼저 `PRIVATE_MATCHING_SERVICE_DESIGN.md`를 읽고 현재 저장소 상태를 분석한 뒤, 구현 계획을 작성하고 Step 1부터 시작하세요.

