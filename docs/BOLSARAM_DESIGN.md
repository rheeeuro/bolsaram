# Private Matching Service - 프로젝트 설계문서

> 목적: 카카오톡 단체방에서 공유되던 소개팅 프로필을 웹 서비스로 구조화하여 관리하고, 초대된 사용자들이 프로필을 필터링해 직접 소개를 신청하고 상대가 수락하는 폐쇄형 소개팅 서비스를 구축한다.

## 1. 제품 한 줄 정의

**주선자가 검증한 프로필만 등록되고, 초대된 사용자들이 직접 탐색 → 신청 → 수락 → 연결되는 비공개 소개팅 마켓.**

사용자 화면은 하트시그널/솔로지옥 같은 연애 프로그램의 감성을 차용하되, 실제 사용성은 매물 탐색형 UI처럼 빠르고 직관적으로 구성한다.

---

## 2. 핵심 제품 원칙

1. **폐쇄형 서비스**
   - 누구나 가입할 수 없는 초대 기반 서비스.
   - 관리자가 기존 카카오톡 프로필을 등록하고, 해당 사용자에게 초대 링크를 발송한다.

2. **추천보다 탐색 우선**
   - AI 추천은 핵심 기능이 아니다.
   - 사용자는 직접 리스트를 보고 조건을 필터링해 상대를 선택한다.

3. **등록은 AI로 최대한 자동화**
   - 카카오톡 스크린샷/원본 사진/텍스트를 업로드하면 AI가 프로필 데이터를 구조화한다.
   - 관리자는 결과를 확인하고 수정 후 등록한다.

4. **프로필은 단계적으로 공개**
   - 리스트: 제한된 정보만 공개.
   - 상세: 직업/학교/지역/취미/이상형 등 공개.
   - 상호 수락 후: 이름/연락 수단 등 연결에 필요한 정보 공개 또는 관리자가 직접 연결.

5. **감성 UI + 실용적 운영 UI 분리**
   - 일반 사용자: 연애 예능 분위기.
   - 관리자: Notion/Linear 스타일의 고밀도 CRM.

---

## 3. 주요 사용자 역할

### 3.1 ADMIN / HOST

주선자 또는 운영자.

권한:
- 프로필 등록/수정/삭제/보관
- AI 기반 프로필 자동 추출
- 사용자 초대 링크 생성
- 프로필 상태 변경
- 소개 신청/수락 현황 관리
- 매칭 후 연결 완료 처리
- 필요 시 신청 제한 및 노출 정책 설정

### 3.2 MEMBER

초대받아 가입한 일반 사용자.

권한:
- 본인 프로필 확인/수정 요청
- 프로필 리스트 탐색
- 필터 적용
- 관심(찜) 저장
- 소개 신청
- 받은 소개 요청 수락/거절
- 보낸/받은 시그널 이력 확인

---

## 4. 핵심 사용자 플로우

### 4.1 프로필 등록 플로우

1. 관리자가 카카오톡에서 받은 프로필 스크린샷/사진/텍스트를 준비한다.
2. 관리자 화면에서 `AI 프로필 등록` 클릭.
3. 여러 파일 및 텍스트를 업로드한다.
4. 서버가 파일을 Private Storage에 업로드한다.
5. Vision/LLM이 데이터를 구조화한다.
6. 추출된 필드를 미리보기 폼에 채운다.
7. 관리자가 수정 후 저장한다.
8. 시스템이 프로필 ID와 초대 링크를 생성한다.
9. 관리자가 초대 링크를 카카오톡으로 전달한다.

### 4.2 사용자 가입 / 프로필 Claim

1. 사용자가 초대 링크 접속.
2. 로그인 또는 본인 인증.
3. `이 프로필이 회원님의 프로필인가요?` 확인.
4. 확인 후 User와 Profile을 연결.
5. 필요한 경우 사용자 본인이 일부 필드를 수정.

### 4.3 탐색 → 신청

1. Discover 진입.
2. 성별/나이/키/지역/직업군/종교/흡연 등 필터 적용.
3. 프로필 카드를 탐색.
4. 상세 페이지 진입.
5. `관심 담기` 또는 `소개 신청하기`.
6. 신청 확인 모달.
7. MatchRequest 생성.
8. 상대에게 알림.

### 4.4 수락 → 연결

1. 상대가 `My Signals`에서 받은 신청 확인.
2. 신청자 프로필 확인.
3. `저도 만나보고 싶어요` 또는 `이번에는 지나칠게요`.
4. 수락 시 MatchRequest = ACCEPTED.
5. 사용자 화면에서 `서로의 마음이 닿았습니다` 연출.
6. 운영자가 연락처 전달/카톡방 생성 후 INTRODUCED 처리.

---

## 5. 사용자 화면 IA

### Bottom Navigation

- Discover
- 관심
- 시그널
- 내 프로필

### 화면 목록

#### A. Entry / Intro
- 하루 최초 방문 또는 첫 가입 시 노출.
- 카피 예시: `오늘, 누구를 만나보고 싶나요?`
- CTA: `사람들 만나보기`

#### B. Discover
- 상단 타이틀: `Discover`
- 성별 segmented control
- 빠른 필터 chips
- 2열 카드 레이아웃
- 정렬: 최근 등록 / 나이 / 키

카드 노출 정보:
- 대표 사진
- 익명 ID (`#17`)
- 출생연도
- 키
- 직업군
- 지역
- 관심 버튼

#### C. Filter Bottom Sheet

초기 필터:
- 성별
- 나이 범위
- 키 범위
- 지역
- 직업군
- 종교
- 흡연 여부

추후:
- 음주
- 학력
- 취미/태그

#### D. Profile Detail

구성:
- 풀폭 대표 사진
- 익명 ID
- 출생연도 / 키 / 지역
- 직업 / 회사 / 학교 / 종교 / MBTI
- 자기소개
- 취미
- 이상형
- 관심 버튼
- 소개 신청 버튼

#### E. Request Modal

카피:
`#17에게 마음을 보내시겠어요?`

설명:
`상대방에게 회원님의 프로필이 전달됩니다.`

CTA:
- 아직 고민할게요
- 마음 보내기

#### F. Request Complete

카피:
`마음을 보냈습니다.`
`상대방의 선택을 기다려주세요.`

#### G. My Signals

Tabs:
- 나에게 온 시그널
- 내가 보낸 시그널
- 연결된 인연

#### H. Signal Detail

상대 프로필 확인 후:
- 이번에는 지나칠게요
- 저도 만나보고 싶어요

#### I. Match Success

연출:
- `IT'S A MATCH`
- 은은한 하트 라인 애니메이션
- 야경/석양/블러 이미지

카피:
`서로의 마음이 닿았습니다.`
`주선자가 두 분을 연결해드릴게요.`

#### J. My Profile

- 내 프로필 보기
- 내가 받은 시그널
- 내가 보낸 시그널
- 관심 목록
- 설정

---

## 6. 관리자 화면 IA

### Admin Navigation

- Dashboard
- 프로필 관리
- 신청 현황
- 회원 관리
- 통계
- 설정

### 6.1 Dashboard

KPI:
- 전체 프로필
- 소개 가능
- 진행 중 신청
- 오늘 신규 신청
- 상호 수락
- 연결 완료

### 6.2 프로필 관리

Table columns:
- ID
- 이름
- 성별
- 출생연도
- 직업
- 지역
- 상태
- 계정 연결 여부
- 등록일

Actions:
- AI 프로필 등록
- 수정
- 상태 변경
- 초대 링크 생성/재발급
- 보관

### 6.3 신청 현황

Columns:
- 신청자
- 대상자
- 상태
- 신청일
- 응답일
- 연결일

### 6.4 회원 관리

- 가입 상태
- 프로필 Claim 상태
- 마지막 로그인
- 차단/비활성화

---

## 7. 디자인 시스템

### 방향

**연애 예능 + 프라이빗 클럽 + 고급 잡지 편집 디자인.**

피해야 할 것:
- Tinder식 과도한 핑크/빨강
- 하트/러브 아이콘 남발
- 너무 가벼운 데이팅앱 느낌
- 카드에 모든 정보를 다 보여주는 채용/부동산 UI

### Color

- Background: `#F6F1EA`
- Surface: `#FFFDF9`
- Text Primary: `#201D1D`
- Text Secondary: `#77706C`
- Primary / Burgundy: `#9B2C3D`
- Accent Rose: `#D96C75`
- Border: `#E8E0D8`

### Typography

- UI: Pretendard 또는 SUIT
- Display/Editorial: MaruBuri 또는 Noto Serif KR

### Radius

- Card: 18~24px
- Bottom Sheet: 28px top radius
- Button: pill 또는 14~18px

### Motion

- 180~280ms 기본 transition
- 프로필 상세 진입 시 이미지 scale/opacity
- 신청 완료는 짧고 절제된 fade + line animation
- Match 성공 화면에서만 감성적인 애니메이션 허용

---

## 8. 기술 스택

### Frontend

- Next.js 16+ (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui
- React Hook Form
- Zod
- TanStack Query 또는 Server Actions 기반
- Framer Motion

### Backend

MVP에서는 별도 NestJS 없이 Next.js Route Handler / Server Actions 사용.

### DB / Auth / Storage

- Supabase
  - PostgreSQL
  - Auth
  - Storage (private bucket)
  - Row Level Security

### AI

- OpenAI API
- Vision input
- Structured Output / JSON Schema

### Deployment

- Vercel
- Supabase Cloud

---

## 9. 데이터 모델

### User

```ts
User {
  id: uuid
  role: 'ADMIN' | 'MEMBER'
  email?: string
  phone?: string
  displayName?: string
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED'
  createdAt: datetime
  updatedAt: datetime
}
```

### Profile

```ts
Profile {
  id: uuid
  userId?: uuid
  publicCode: string // #17
  name?: string
  gender: 'MALE' | 'FEMALE'
  birthYear: number
  height?: number
  jobTitle?: string
  jobCategory?: string
  company?: string
  education?: string
  location?: string
  religion?: string
  mbti?: string
  smoking?: boolean
  drinking?: string
  hobbies: string[]
  bio?: string
  idealTypeText?: string
  status: 'AVAILABLE' | 'MATCHING' | 'PAUSED' | 'DATING' | 'ARCHIVED'
  createdAt: datetime
  updatedAt: datetime
}
```

### ProfileImage

```ts
ProfileImage {
  id: uuid
  profileId: uuid
  storagePath: string
  order: number
  type: 'MAIN' | 'LIFESTYLE' | 'SOURCE'
  createdAt: datetime
}
```

### ProfileSource

```ts
ProfileSource {
  id: uuid
  profileId?: uuid
  type: 'KAKAO_SCREENSHOT' | 'IMAGE' | 'TEXT'
  storagePath?: string
  rawText?: string
  extractionJson?: jsonb
  extractionStatus: 'PENDING' | 'SUCCESS' | 'FAILED'
  createdAt: datetime
}
```

### Favorite

```ts
Favorite {
  userId: uuid
  profileId: uuid
  createdAt: datetime
}
```

Unique: `(userId, profileId)`

### MatchRequest

```ts
MatchRequest {
  id: uuid
  requesterProfileId: uuid
  targetProfileId: uuid
  status:
    | 'REQUESTED'
    | 'ACCEPTED'
    | 'REJECTED'
    | 'CANCELED'
    | 'INTRODUCED'
    | 'CLOSED'
  requestedAt: datetime
  respondedAt?: datetime
  introducedAt?: datetime
  closedAt?: datetime
}
```

Business constraints:
- 자기 자신에게 신청 불가.
- 동일한 두 프로필 간 ACTIVE 상태 요청 중복 생성 금지.
- ARCHIVED/PAUSED 프로필에는 신청 불가.
- 추후 설정값으로 동시 대기 요청 제한 가능.

### Invite

```ts
Invite {
  id: uuid
  profileId: uuid
  tokenHash: string
  status: 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED'
  expiresAt: datetime
  usedAt?: datetime
  createdAt: datetime
}
```

---

## 10. AI 프로필 추출

### Input

- 카카오톡 스크린샷 1~N장
- 프로필 사진 0~N장
- 추가 텍스트

### Output JSON Schema

```json
{
  "gender": null,
  "birthYear": 1987,
  "height": 172,
  "jobTitle": "계리사",
  "jobCategory": "금융/보험",
  "company": "외국계 보험사",
  "education": "성균관대학교",
  "location": "신도림",
  "religion": "무교",
  "mbti": "ISTJ",
  "smoking": false,
  "drinking": null,
  "hobbies": ["운동", "재테크"],
  "bio": "자기계발을 열심히 함",
  "idealTypeText": "배려심 있고 선한 분",
  "confidence": {
    "birthYear": 0.99,
    "jobTitle": 0.99,
    "company": 0.95,
    "location": 0.98
  }
}
```

### 추출 원칙

- 텍스트가 없거나 확실하지 않으면 `null`.
- 추론으로 사실을 생성하지 않는다.
- `사는 곳: 신도림 (자가)`라면 location과 주거 메모를 분리할 수 있도록 raw source 유지.
- 원본 이미지는 반드시 보존.
- AI 결과는 관리자 확인 후 최종 저장.

---

## 11. API 설계

### Auth

- `POST /api/auth/...` - Supabase Auth 사용

### Profiles

- `GET /api/profiles`
- `GET /api/profiles/:id`
- `POST /api/admin/profiles`
- `PATCH /api/admin/profiles/:id`
- `POST /api/admin/profiles/:id/invite`

Query example:

```txt
/api/profiles?gender=FEMALE&birthYearMin=1990&birthYearMax=1995&heightMin=160&location=서울&jobCategory=IT
```

### Favorites

- `GET /api/favorites`
- `POST /api/favorites/:profileId`
- `DELETE /api/favorites/:profileId`

### Match Requests

- `GET /api/match-requests?type=received`
- `GET /api/match-requests?type=sent`
- `POST /api/match-requests`
- `POST /api/match-requests/:id/accept`
- `POST /api/match-requests/:id/reject`
- `POST /api/match-requests/:id/cancel`
- `POST /api/admin/match-requests/:id/introduced`

### AI Import

- `POST /api/admin/profile-imports`
- multipart upload
- 비동기 분석 또는 MVP에서는 동기 처리

---

## 12. 보안 / 개인정보

이 서비스는 개인정보 민감도가 높으므로 반드시 기본 보안 요구사항을 적용한다.

### 필수

- Supabase Storage private bucket
- Signed URL 사용
- RLS 활성화
- 관리자/사용자 Role 기반 접근 제어
- 모든 mutation 서버 측 권한 검증
- 원본 이미지 public URL 금지
- 초대 token은 평문 저장하지 않고 hash 저장
- 운영 로그에 프로필 원문/민감 데이터 출력 금지
- 삭제 시 soft delete + 필요 시 실제 파일 삭제 워크플로 지원

### 공개 범위

리스트:
- 익명 ID
- 사진
- 출생연도
- 키
- 직업군
- 지역

상세:
- 회사/학교/취미/MBTI/이상형 등

상호 수락 후:
- 이름/연락처 또는 관리자 연결

---

## 13. 디렉터리 구조 제안

```txt
src/
  app/
    (member)/
      discover/
      profiles/[id]/
      favorites/
      signals/
      profile/
    admin/
      dashboard/
      profiles/
      match-requests/
      members/
    invite/[token]/
    api/
  components/
    ui/
    profile/
    signals/
    admin/
  features/
    auth/
    profiles/
    favorites/
    matching/
    profile-import/
  lib/
    supabase/
    openai/
    auth/
    validation/
  server/
    repositories/
    services/
  types/
```

---

## 14. 구현 우선순위

### Phase 1 - Foundation
- Next.js 초기화
- Tailwind / shadcn
- Supabase 연결
- Auth
- DB schema + RLS
- 디자인 토큰

### Phase 2 - Profile browsing
- Discover
- 필터 Bottom Sheet
- 프로필 상세
- Private image signed URL

### Phase 3 - Matching
- Favorite
- 소개 신청
- 받은/보낸 시그널
- 수락/거절
- Match 성공 화면

### Phase 4 - Admin
- 관리자 Dashboard
- 프로필 CRUD
- MatchRequest 관리
- Invite 생성

### Phase 5 - AI import
- 다중 이미지 업로드
- OpenAI Vision structured extraction
- 관리자 확인/수정 UI
- Profile 생성

### Phase 6 - Polish
- 애니메이션
- 에러/빈 상태
- 모바일 최적화
- 알림
- 테스트

---

## 15. MVP 완료 기준

1. 관리자가 프로필을 등록할 수 있다.
2. 관리자가 AI Import로 카카오톡 스크린샷을 구조화할 수 있다.
3. 사용자는 초대 링크로 자신의 프로필을 Claim할 수 있다.
4. 사용자는 소개 가능한 프로필만 조회할 수 있다.
5. 필터가 동작한다.
6. 프로필 상세를 볼 수 있다.
7. 관심 목록에 저장할 수 있다.
8. 상대에게 소개 신청할 수 있다.
9. 상대는 수락/거절할 수 있다.
10. 양측 수락 시 Match 화면이 나온다.
11. 관리자는 연결 완료 상태를 처리할 수 있다.
12. 프로필 사진은 비공개 저장소와 Signed URL로만 제공된다.

---

## 16. 비목표(초기에는 만들지 않음)

- 실시간 채팅
- AI 자동 궁합 추천
- 위치 기반 주변 사용자
- 공개 회원가입
- 결제/구독
- 복잡한 점수형 매칭 알고리즘
- 커뮤니티
- 사용자 간 직접 연락처 교환 자동화

---

## 17. 참고 UI

이 프로젝트를 시작할 때 함께 전달한 컨셉 이미지 파일:

`a_clean_product_showcase_ui_mockup_collage_on_a.png`

해당 이미지를 완전히 복제하지 말고 아래 디자인 원칙만 참고한다.

- warm ivory / burgundy palette
- large portrait photography
- editorial serif headings
- restrained motion
- profile discovery as a casting/show experience
- admin dashboard is utilitarian and dense

