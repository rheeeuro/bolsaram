# 볼사람(bolsaram)

카톡 오픈채팅에서 흩어지는 소개팅 후보 정보를 구조화하고, 주선자가 조건과 진행 상태를 빠르게 확인·관리할 수 있게 만든 **방(Room) 기반 후보 정보 관리·매칭 CRM**입니다.

후보를 구조화해 등록하고, 조건으로 검토·추천하고, 매칭 진행을 관리하며, 카톡 공유글까지 만드는 운영 도구입니다.

## 서비스 구성

| 레이어 | 구성 | 포트 / 프로세스 |
| --- | --- | --- |
| 프론트엔드 | Next.js 16 · React 19 (`frontend/`) | `:3020` · PM2 `bolsaram-fe` |
| 백엔드 | FastAPI · PyMySQL (`backend/app/main.py`) | `:8010` · PM2 `bolsaram-be` |
| 데이터베이스 | MariaDB 11.4 (`sql/schema.sql`) | `:3308` |
| 유지보수 배치 | 장기 미활동 후보 자동 비공개 (`backend/app/maintenance.py`) | PM2 `bolsaram-maintenance` (매일 04:00) |

- Next.js가 `/api/*` 요청을 백엔드로 프록시하고, 인증은 쿠키 기반 세션(`sessions` 테이블)을 사용합니다.
- DB 테이블: `users · sessions · rooms · room_members · candidates · candidate_photos · matches · match_logs`
- 매칭 점수 로직은 서버(`backend/app/matching.py`)와 클라이언트(`frontend/app/lib.js`)가 동일한 규칙을 사용합니다.
- AI 보조 기능(카톡 파싱·개인정보 위험 감지)은 외부 API 없이 **규칙 기반**으로 동작합니다.

## 핵심 개념

- **방(Room)**: 모든 후보 데이터는 방에 속하며 방 밖으로 노출되지 않습니다.
  - **공개방** — 앱에서 탐색해 입장합니다.
  - **비공개방** — 초대 코드 또는 `/join/{code}` 링크로만 입장합니다.
- **권한(역할)**: `owner`(소유자) · `admin`(관리자) · `member`(멤버)는 쓰기 가능, `viewer`(읽기 전용)는 조회만 가능합니다. 역할 변경은 owner만 할 수 있습니다.
- **요금제 한도**: `free`(방 1·후보 30) / `pro`(방 5·후보 300) / `group`(방 20·후보 1000). 후보 한도는 방 소유자의 플랜 기준입니다. *업그레이드/결제 UI는 미구현이며 플랜 값은 현재 DB에서 직접 변경합니다(기본 free).*
- **개인정보 보호**: 입력·공유 단계에서 전화번호·이메일·SNS·상세 주소·차량번호·주민번호 형식을 자동 감지해 경고하고, 연락처는 매칭 '수락' 이상 단계에서만 공개합니다. 180일 미활동 후보는 배치로 자동 비공개 전환됩니다.

## 주요 기능

- 이메일/비밀번호 회원가입·로그인 (가입 후 방을 직접 생성하거나 초대 코드로 입장)
- 공개방/비공개방 생성·탐색·입장, 입장 코드·링크 발급 및 재발급
- 카톡 원문 붙여넣기 기반 자동 필드 분리, 중복 의심 후보 체크
- 성별·나이·키·지역·직업군·종교·흡연·상태 필터와 최근순/추천순 정렬
- 점수 기반 추천 후보와 추천 이유, 운영 체크(중복·동의·흡연·상태 경고)
- 후보 사진 업로드(워터마크 합성)와 후보별 진행 상태·검토 로그 관리
- 칸반형 매칭 보드(추천 → 제안 → 수락 → 연락처 교환 → 만남 예정 → 완료/거절)
- 현황 대시보드(지표·상태 분포·최근 활동·동의/미활동 경고)
- 톤별 카톡 공유용 소개글 생성·복사(정보형·소개형·오픈채팅용·격식형 + 클린메시지)
- 방 멤버 관리 및 역할 변경(읽기 전용 게이팅)

## 이용 방법

1. **로그인/회원가입** — 가입 후 방 목록 화면에서 방을 직접 만들거나 초대 코드로 입장합니다.
2. **방 목록 화면** — 두 탭으로 구성됩니다.
   - **방 목록 탭** — 현재 입장 중인 공개/비공개방 카드 목록
   - **탐색 탭** — 새로운 공개방을 탐색하고 이름 검색·정렬(후보/멤버/이름순)로 조건 검색해 입장
   - 상단 `＋ 방 생성`(공개/비공개 선택)과 `코드로 입장`(비공개방 코드)을 제공합니다.
3. **방 워크스페이스** — 상단에 `← 방 목록`, 방 제목·뱃지, 링크 복사(비공개방)·멤버·후보 등록 버튼이 있고 아래 3개 탭으로 나뉩니다. 방 생성·참가·전환은 `← 방 목록`으로 나가 방 목록 화면에서 합니다.
   - **현황** — 등록 후보·소개 가능·진행 중 매칭·만남 예정 지표, 동의 확인 필요/90일+ 미활동 경고, 상태 분포, 최근 활동
   - **후보** (3분할 메인 화면) — ① 필터·통계 ② 후보 리스트(최근순/추천순) ③ 후보 상세(프로필·사진, 운영 체크, 진행 상태, 추천 후보, 진행 로그, 카톡 공유글)
   - **매칭 보드** — 칸반으로 매칭 단계를 관리하며 연락처는 '수락' 이상 단계에서만 공개
4. **후보 등록** — 모달에 카톡 원문을 붙여넣고 `자동 분리`를 누르면 출생연도·키·MBTI·지역·학력·직업 등이 자동으로 채워집니다. 등록 시 정보 등록·공유 **동의 체크가 필수**입니다.

## 실행

### 1. Node 의존성 설치

```bash
npm --prefix frontend install
```

### 2. Python 가상환경 및 백엔드 의존성 설치

이 환경에서는 `uv`를 사용합니다.

```bash
uv venv backend/.venv
uv pip install --python backend/.venv/bin/python -r backend/requirements.txt
```

### 3. MariaDB 실행

요구사항에 맞춰 `bolsaram_mariadb` 컨테이너를 `0.0.0.0:3308 -> 3306/tcp`로 실행합니다.

```bash
npm run db:up
```

DB 접속 정보(`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`)는 `docker-compose.yml`과 환경변수로 관리합니다. 기본 접속 포트는 `3308`이며, 자격 증명 값은 README에 노출하지 않습니다.

### 4. FastAPI 백엔드 실행

현재 작업 환경에서는 8000-8002 포트가 다른 프로젝트에서 사용 중이라, 기본 API 포트는 8010으로 설정했습니다.

```bash
npm run dev:api
```

API: `http://localhost:8010`

### 5. Next.js 프론트엔드 실행

```bash
npm run dev
```

Frontend: `http://localhost:3020`

프론트에서 다른 API 주소를 쓰려면 다음 환경변수를 설정합니다.

```bash
NEXT_PUBLIC_API_URL=http://localhost:8010 npm run dev
```

백엔드 CORS 허용 origin은 `FRONTEND_ORIGINS`로 바꿀 수 있습니다.

```bash
FRONTEND_ORIGINS=http://localhost:3020 npm run dev:api
```

## 운영 (PM2)

```bash
pm2 restart bolsaram-fe bolsaram-be   # 운영 프로세스 재시작
pm2 status bolsaram-fe bolsaram-be    # 상태 확인
curl http://127.0.0.1:8010/health     # 백엔드 헬스체크
curl -I http://127.0.0.1:3020         # 프론트엔드 응답 확인
```

PM2 설정 파일은 `ecosystem.config.cjs`입니다.

## 개발 명령

```bash
npm run check
npm run build
npm run db:logs
```

`npm run check`는 FastAPI 문법 검사와 Next.js 프로덕션 빌드를 함께 실행합니다.

## 구조

```text
.
├── frontend/
│   ├── app/
│   │   ├── BolsaramApp.jsx      # 메인 앱 UI
│   │   ├── lib.js              # API 클라이언트·매칭 점수·파싱·공유글 헬퍼
│   │   ├── globals.css         # 디자인 시스템(라이트, 세이지 그린)
│   │   ├── layout.jsx
│   │   ├── page.jsx
│   │   ├── join/[code]/page.jsx # 비공개방 입장 링크
│   │   └── rooms/[roomId]/page.jsx
│   ├── next.config.mjs
│   └── package.json
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI 라우트
│   │   ├── matching.py         # 매칭 점수 모듈
│   │   └── maintenance.py      # 장기 미활동 자동 비공개 배치
│   └── requirements.txt
├── sql/
│   └── schema.sql
├── ecosystem.config.cjs
├── docker-compose.yml
├── package.json
└── README.md
```

## 비공개방 입장 흐름

1. 로그인 후 `방 생성`에서 `비공개방`을 선택합니다.
2. 생성된 입장 코드 또는 `/join/{code}` 링크를 복사해 공유합니다.
3. 초대받은 사용자는 로그인 후 `새로운 방 참가하기 → 비공개방`에 코드를 입력하거나 링크로 접속해 입장합니다.
