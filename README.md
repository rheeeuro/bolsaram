# 볼사람(bolsaram)

카톡 오픈채팅에서 흩어지는 소개팅 후보 정보를 구조화하고, 주선자가 조건과 진행 상태를 빠르게 확인할 수 있게 만든 웹 애플리케이션입니다.

## Stack

- Frontend: Next.js 16, React 19
- Backend: FastAPI, PyMySQL
- Database: MariaDB 11.4

## 주요 기능

- 이메일/비밀번호 기반 회원가입 및 로그인
- MariaDB 저장소 기반 후보/진행 로그 관리
- 공개방과 비공개방 생성 및 선택
- 비공개방 입장 코드와 `/join/{code}` 입장 링크 발급
- 카톡 원문 붙여넣기 기반 자동 필드 분리
- 중복 의심 후보 체크
- 성별, 나이, 키, 지역, 직업군, 종교, 흡연, 상태 필터
- 점수 기반 추천 후보와 추천 이유
- 매칭 검토 로그와 후보별 진행 상태 관리
- 톤별 카톡 공유용 소개글 생성 및 복사

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

기본 DB 접속값:

```text
DB_HOST=127.0.0.1
DB_PORT=3308
DB_NAME=bolsaram
DB_USER=bolsaram_user
DB_PASSWORD=bolsaram0711
DB_ROOT_PASSWORD=root0711
```

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
│   │   ├── BolsaramApp.jsx
│   │   ├── globals.css
│   │   ├── layout.jsx
│   │   ├── page.jsx
│   │   └── join/[code]/page.jsx
│   ├── next.config.mjs
│   ├── package.json
│   └── package-lock.json
├── backend/
│   ├── app/main.py
│   └── requirements.txt
├── docker-compose.yml
├── package.json
├── sql/
│   └── schema.sql
└── README.md
```

## 비공개방 입장 흐름

1. 로그인 후 `방 생성`에서 `비공개방`을 선택합니다.
2. 생성된 입장 코드 또는 `/join/{code}` 링크를 복사해 공유합니다.
3. 초대받은 사용자는 로그인 후 `비공개 입장`에 코드를 입력하거나 링크로 접속해 입장합니다.
