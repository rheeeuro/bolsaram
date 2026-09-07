# 볼사람(Bolsaram) 설계 변경사항 문서 --- Telegram Import 전환 v1

-   문서 목적: 기존 설계대로 개발이 진행된 상태에서 **모바일 OS Share
    Extension 우선 구조를 Telegram Bot 기반 Import 우선 구조로
    변경**하기 위한 영향 범위와 구현 지침을 정의한다.
-   기준 서비스명: 볼사람(Bolsaram)
-   변경 유형: Import 진입점 변경
-   핵심 원칙: **기존 Import 도메인과 AI/관리자 흐름은 최대한 유지하고,
    입력 어댑터만 Telegram 중심으로 교체한다.**

------------------------------------------------------------------------

## 1. 변경 배경

기존 설계의 핵심 요구사항은 다음과 같았다.

> 카카오톡에서 받은 프로필 이미지 여러 장과 프로필 글을 모바일에서
> 이미지 저장 없이 볼사람으로 업로드한다.

이를 위해 기존 설계는 다음 구조를 채택했다.

``` text
KakaoTalk
  ↓
OS Share Sheet
  ↓
Bolsaram Mobile
  ├ iOS Share Extension
  └ Android Share Intent
  ↓
ImportSession
  ↓
AI Extraction
  ↓
Admin Review
  ↓
Profile
```

이 구조는 최종 UX로는 이상적이지만 다음 부담이 있다.

-   별도 모바일 앱 필요
-   iOS Share Extension 구현/배포
-   Android Share Intent 처리
-   App Store / Play Store 배포
-   OS/카카오톡 조합별 payload 검증
-   사진 여러 장 + 텍스트 동시 공유 가능 여부의 불확실성
-   운영자용 기능 하나를 위해 모바일 네이티브 범위가 커짐

MVP에서는 이 비용이 과하다.

따라서 **주선자 전용 Import 도구로 Telegram Bot을 도입**하고, OS Share
Extension은 후속 버전으로 내린다.

------------------------------------------------------------------------

## 2. 변경 결정

### 기존

**Primary Import Channel** - OS Share Extension / Android Share Intent

### 변경

**Primary Import Channel** - Telegram Bot

### 유지

-   Web 직접 업로드
-   Screenshot Import
-   Text Paste
-   Import Inbox
-   AI Extraction
-   Admin Review
-   Profile Commit

### 후순위

-   Bolsaram Mobile App
-   iOS Share Extension
-   Android Share Intent

------------------------------------------------------------------------

## 3. 변경 후 아키텍처

``` text
KakaoTalk
   ↓
사용자가 Telegram의 Bolsaram Bot으로 전달
   ↓
Telegram Bot API / Webhook
   ↓
TelegramImportAdapter
   ↓
ImportSession
   ├ ImportAsset[]
   └ rawText
   ↓
AI Extraction
   ↓
Admin Review
   ↓
Profile
```

사용자용 서비스는 기존대로 Web 중심으로 유지한다.

``` text
일반 회원
→ Bolsaram Web

주선자
→ Bolsaram Web
→ Telegram Bolsaram Bot
```

Telegram은 **일반 사용자 채널이 아니라 주선자용 운영 도구**로만
사용한다.

------------------------------------------------------------------------

## 4. 핵심 UX

### 4.1 프로필 등록

예시:

``` text
[Bolsaram Bot]

주선자:
[사진1]
[사진2]
[사진3]

Bot:
사진 3장을 받았어요.
이제 프로필 글을 보내주세요.

주선자:
87년생
계리사
외국계 보험사
신도림
172cm
...

Bot:
프로필을 분석하고 있어요.

↓

87년생 · 172cm
계리사
외국계 보험사
신도림

[등록 준비 완료]
[관리자에서 확인]
```

Bot 안에서 모든 수정 UX를 구현하지 않는다.

최종 검토는 기존 Admin Import Review 화면으로 보낸다.

------------------------------------------------------------------------

## 5. Telegram 메시지 처리

### 5.1 이미지

Telegram Bot API에서 수신한 `photo` 또는 document/image 메시지를
처리한다.

처리 흐름:

1.  webhook 수신
2.  Telegram file metadata 확인
3.  file id 기반으로 파일 획득
4.  Supabase private storage에 복사
5.  ImportAsset 생성

Telegram의 외부 파일 URL을 ProfileImage의 영구 URL로 저장하지 않는다.

### 5.2 여러 이미지

Telegram album은 `media_group_id`를 기준으로 하나의 그룹으로 묶는다.

서버에서 바로 각 메시지를 독립 프로필로 만들지 않는다.

예:

``` text
media_group_id = 12345

image A
image B
image C
```

↓

``` text
ImportSession #ABC

assets:
- A
- B
- C
```

앨범이 여러 webhook으로 분리되어 들어올 수 있으므로 debounce/buffering이
필요하다.

권장: - 첫 media_group 메시지 수신 - 짧은 window 동안 동일
`media_group_id` 누적 - inactivity 후 asset group 완료 처리

### 5.3 텍스트

텍스트 메시지는 현재 활성 ImportSession의 `rawText`에 연결한다.

### 5.4 Caption

이미지 caption이 있으면 rawText 후보로 사용할 수 있다.

우선순위:

1.  명시적으로 보낸 후속 텍스트 메시지
2.  album/photo caption
3.  없음

------------------------------------------------------------------------

## 6. Telegram Import 상태 머신

기존 ImportSession을 유지하고 Telegram 전용 세션 상태만 추가한다.

권장 상태:

``` text
WAITING_MEDIA
→ WAITING_TEXT
→ READY_TO_ANALYZE
→ ANALYZING
→ REVIEW_REQUIRED | READY
→ IMPORTED
```

기존 ImportSession status와 완전히 합치지 않고, 필요하면 Telegram
conversation state를 별도 테이블에서 관리한다.

------------------------------------------------------------------------

## 7. 신규 데이터 모델

### TelegramConnection

``` text
id
userId
telegramUserId
telegramChatId
createdAt
updatedAt
```

용도: - 어떤 Telegram 사용자가 어떤 Bolsaram 운영자인지 연결 - 허가되지
않은 Telegram 사용자 차단

### TelegramImportSession

``` text
id
telegramChatId
telegramUserId
importSessionId
mediaGroupId nullable
state
lastActivityAt
createdAt
updatedAt
```

상태 예:

``` text
WAITING_MEDIA
WAITING_TEXT
READY
CANCELED
EXPIRED
```

### TelegramWebhookEvent

``` text
id
telegramUpdateId UNIQUE
eventType
payloadHash
processedAt nullable
createdAt
```

용도: - webhook 중복 처리 방지 - idempotency

------------------------------------------------------------------------

## 8. 기존 모델 영향

### 유지

-   ImportSession
-   ImportAsset
-   ImportExtraction
-   Profile
-   ProfileImage
-   MatchRequest
-   Favorite
-   Invite
-   AuditLog

### ImportSession.source

기존:

``` text
KAKAO_SHARE
MANUAL_UPLOAD
SCREENSHOT
TEXT
```

변경:

``` text
TELEGRAM
MANUAL_UPLOAD
SCREENSHOT
TEXT
KAKAO_SHARE  // 향후 OS Share 기능을 다시 넣을 경우를 위해 유지 가능
```

`KAKAO_SHARE`를 이미 migration에 넣었다면 삭제 migration을 만들지
않는다.

------------------------------------------------------------------------

## 9. 신규 서버 컴포넌트

권장 구조:

``` text
apps/web/
└ app/api/integrations/telegram/webhook/route.ts

packages/
└ integrations/
   └ telegram/
      ├ client.ts
      ├ adapter.ts
      ├ parser.ts
      ├ session.ts
      └ types.ts
```

### TelegramImportAdapter 역할

Telegram-specific payload를 domain input으로 변환한다.

``` text
Telegram Update
   ↓
TelegramImportAdapter
   ↓
IncomingImportPayload
   ↓
Import Service
```

Import core가 Telegram Bot API 타입을 직접 알지 않게 한다.

------------------------------------------------------------------------

## 10. Webhook API

### Endpoint

``` text
POST /api/integrations/telegram/webhook
```

책임:

-   webhook 인증/검증
-   update_id 기반 중복 방지
-   sender 식별
-   허용된 TelegramConnection 확인
-   message type parsing
-   import session 처리
-   빠른 응답

AI 분석을 webhook request 안에서 오래 실행하지 않는다.

권장:

``` text
Webhook
→ event save
→ asset/text update
→ async analyze trigger
```

------------------------------------------------------------------------

## 11. 봇 명령

초기 MVP:

``` text
/start
/new
/cancel
/status
```

### `/start`

-   계정 연결 안내

### `/new`

-   기존 미완료 session이 있으면 확인 후 새 세션
-   새 프로필 등록 시작

### `/cancel`

-   현재 ImportSession 취소

### `/status`

-   현재 session에 들어온 이미지 수/텍스트 여부 표시

복잡한 자연어 명령은 MVP에서 제외한다.

------------------------------------------------------------------------

## 12. Bot 응답 UX

문구는 운영자 도구답게 짧게 한다.

예:

``` text
새 프로필 등록을 시작합니다.
사진을 보내주세요.
```

사진 누적:

``` text
사진 3장을 받았습니다.
프로필 글을 보내주세요.
```

텍스트 수신:

``` text
프로필 내용을 받았습니다.
분석을 시작합니다.
```

분석 완료:

``` text
분석이 완료되었습니다.

1987년생 · 172cm
계리사
신도림

관리자 화면에서 확인해주세요.
[프로필 검토]
```

버튼은 Web deep link로 연결한다.

------------------------------------------------------------------------

## 13. 관리자 화면 변경

기존 `/admin/imports`를 그대로 유지한다.

추가 표시:

``` text
Source
- Telegram
- Manual
- Screenshot
```

Telegram Import 상세에는 다음 메타데이터를 보여줄 수 있다.

-   Telegram source
-   받은 이미지 수
-   raw text
-   수신 시각

Telegram username/ID는 일반 관리자 UI에 불필요하게 노출하지 않는다.

------------------------------------------------------------------------

## 14. 인증/권한

Telegram Bot은 공개적으로 검색될 수 있으므로 **아무나 프로필을 등록할 수
있게 하면 안 된다.**

MVP 권장:

1.  Bolsaram 관리자 화면에서 Telegram 연결 코드 생성
2.  Bot에서 `/start <one-time-code>`
3.  Telegram user/chat과 Bolsaram ADMIN 계정 연결
4.  이후 해당 Telegram user/chat만 Import 허용

예:

``` text
Bolsaram Admin
→ Telegram 연결
→ one-time code 생성
→ t.me/BolsaramBot?start=abc123
→ Bot open
→ 계정 연결
```

연결 코드는: - 짧은 만료 시간 - 1회 사용 - DB에는 hash 저장 권장

------------------------------------------------------------------------

## 15. 보안/개인정보 변경사항

Telegram 방식을 사용하면 데이터 경로가 다음처럼 늘어난다.

``` text
KakaoTalk
→ Telegram
→ Bolsaram
```

따라서 다음을 명확히 한다.

-   Telegram은 주선자용 내부 운영 채널로만 사용
-   Telegram에서 받은 파일은 즉시 Bolsaram private storage로 복사
-   Bot file reference만 장기 저장하지 않음
-   처리 완료 후 불필요한 Telegram metadata 저장 최소화
-   raw Telegram webhook payload 장기 저장 금지 또는 짧은 retention
-   Telegram 계정 연결은 ADMIN만 가능
-   사용자의 프로필 데이터가 Telegram을 거친다는 점을 개인정보/운영
    정책에서 검토
-   로그에 이미지 URL/raw profile text를 남기지 않음

장기적으로 개인정보 경로를 줄여야 할 경우 OS Share Extension으로
이전한다.

------------------------------------------------------------------------

## 16. OS Share 기존 구현 처리

### 이미 구현된 공통 코드

유지: - ImportSession - ImportAsset - AI extraction - Storage upload -
Import review - Profile commit - Incoming payload normalization
abstraction

### 이미 구현된 Expo app

삭제하지 않는다.

다음 중 하나로 처리:

``` text
apps/mobile/
```

-   개발 중단 상태로 유지
-   experimental flag
-   README에 `post-MVP`로 표시

### Share Extension/Intent native code

아직 초기 skeleton 수준이라면 기능 개발 우선순위를 낮춘다.

이미 안정적으로 동작한다면 제거하지 않고 optional import channel로
남겨도 된다.

------------------------------------------------------------------------

## 17. Codex 구현 변경 지침

기존 코드를 갈아엎지 않는다.

작업 순서:

1.  기존 Import 관련 구현 audit
2.  공통 Import service와 OS Share-specific code 경계 확인
3.  `ImportSession.source`에 TELEGRAM 추가
4.  Telegram integration package 추가
5.  webhook endpoint
6.  Telegram account linking
7.  multi-photo/media_group aggregation
8.  text association
9.  Import Inbox 연결
10. AI analyze trigger
11. deep link review
12. idempotency/security tests
13. 기존 mobile share 코드는 deprecated 하지 말고 post-MVP로 표시

------------------------------------------------------------------------

## 18. 테스트

필수 테스트:

### Webhook

-   동일 update_id 두 번 전달
-   허가되지 않은 Telegram user
-   text-only
-   single photo
-   multiple photo album
-   photo + caption
-   images then text
-   `/cancel`

### Import

-   여러 이미지가 하나의 ImportSession에 포함
-   순서 보존
-   storage upload 실패 재시도
-   AI 실패
-   commit idempotency

### Security

-   연결되지 않은 Telegram 계정 차단
-   expired pairing code
-   reused pairing code
-   다른 ADMIN session 침범 방지

------------------------------------------------------------------------

## 19. MVP 변경 완료 기준

다음이 실제 Telegram 앱에서 작동하면 변경 완료다.

1.  주선자가 Telegram Bolsaram Bot을 Bolsaram 계정과 연결
2.  `/new`
3.  프로필 사진 여러 장 전송
4.  Bot이 같은 ImportSession으로 묶음
5.  프로필 텍스트 전송
6.  ImportSession에 rawText 저장
7.  AI extraction
8.  Bot에서 분석 완료 안내
9.  Web Admin Review 이동
10. 수정 후 Profile 등록

------------------------------------------------------------------------

## 20. 후속 로드맵

### MVP

-   Telegram Bot
-   Web Import
-   Screenshot Import

### vNext

-   Telegram UX 개선
-   Push/notification
-   운영 통계

### 장기

-   Bolsaram Mobile
-   iOS Share Extension
-   Android Share Intent

장기적으로 OS Share가 구현되더라도 Telegram Import는 Power User/관리자
채널로 유지할 수 있다.

------------------------------------------------------------------------

## 21. 최종 변경 요약

### 변경 전

``` text
KakaoTalk
→ OS Share
→ Bolsaram Mobile
→ Import
```

### 변경 후

``` text
KakaoTalk
→ Telegram Bolsaram Bot
→ Telegram Webhook
→ Import
```

### 변경하지 않는 핵심

``` text
ImportSession
→ ImportAsset
→ AI Extraction
→ Admin Review
→ Profile
```

즉 이번 변경의 목적은 **이미 개발한 볼사람의 핵심 Import 파이프라인을
버리지 않고, MVP에서 가장 비용이 큰 모바일 네이티브 진입점을 Telegram
Bot으로 교체하는 것**이다.
