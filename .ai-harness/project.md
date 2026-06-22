# AI 하네스: 볼사람

이 저장소는 Codex와 Claude Code가 함께 사용하는 프로젝트입니다. 두 도구 모두 코드를 변경하기 전에 이 파일의 기준을 따릅니다.

## 프로젝트 구조

- 제품: 볼사람, 방 기반 소개팅 후보 관리 앱.
- 프론트엔드: `frontend/`의 Next.js 16, React 19.
- 백엔드: `backend/app/main.py`의 FastAPI, PyMySQL.
- 데이터베이스: MariaDB, 스키마는 `sql/schema.sql`.
- 주요 UI 파일: `frontend/app/BolsaramApp.jsx`, `frontend/app/globals.css`.
- Next.js는 `frontend/next.config.mjs`에서 `/api/*` 요청을 백엔드로 프록시합니다.

## 실행 환경

- 프론트엔드 운영 포트: `3020`.
- 백엔드 API 포트: `8010`.
- MariaDB 호스트 포트: `3308`.
- PM2 프로세스명: `bolsaram-fe`, `bolsaram-be`.
- PM2 설정 파일: `ecosystem.config.cjs`.

## 자주 쓰는 명령

```bash
npm run db:up
npm run dev:api
npm run dev
npm run check
npm --prefix frontend run build
pm2 restart bolsaram-fe bolsaram-be
pm2 status bolsaram-fe bolsaram-be
curl http://127.0.0.1:8010/health
curl -I http://127.0.0.1:3020
```

가능하면 전체 검증은 다음 명령으로 진행합니다.

```bash
npm run check
```

백엔드만 좁게 수정했다면 최소한 다음 명령을 실행합니다.

```bash
backend/.venv/bin/python -m py_compile backend/app/main.py
```

프론트엔드를 수정했다면 다음 명령을 실행합니다.

```bash
npm --prefix frontend run build
```

## 작업 규칙

- 사용자가 다른 언어를 요청하지 않는 한 응답과 요약은 한글로 작성합니다.
- 기존 한글 UI 문구 스타일을 유지합니다. 짧고 직접적이며 운영 도구처럼 명확하게 씁니다.
- 사용자가 명시적으로 요청하지 않는 한 커밋하지 않습니다.
- 사용자의 변경을 되돌리지 않습니다. 큰 변경 전에는 `git status --short`로 상태를 확인합니다.
- 요청된 동작에 필요한 범위로만 수정합니다.
- `frontend/.next/`, `frontend/node_modules/`, Python `__pycache__` 같은 생성물과 의존성 디렉터리는 수정하지 않습니다.
- Python 실행으로 추적 중인 `__pycache__` 파일이 변경되면 마무리 전에 원래 내용으로 복구합니다.
- 새 라이브러리를 도입하기보다 `BolsaramApp.jsx`와 `globals.css`의 기존 패턴을 우선합니다.
- 방 접근 흐름을 바꿀 때는 프론트엔드 화면 흐름과 백엔드 권한/API 구조를 함께 맞춥니다.
- 작업 마무리 시 실행 중인 운영 앱에 반영해야 하는 변경이라면, 변경 범위에 맞는 PM2 프로세스를 재시작합니다.
- 프론트엔드 변경(`frontend/`, Next 설정 등)은 `pm2 restart bolsaram-fe`를 실행합니다.
- 백엔드 변경(`backend/`, `sql/`, API 동작 등)은 `pm2 restart bolsaram-be`를 실행합니다.
- 프론트엔드와 백엔드 모두에 영향이 있거나 `ecosystem.config.cjs`, 루트 실행 설정을 바꿨다면 `pm2 restart bolsaram-fe bolsaram-be`를 실행합니다.
- PM2를 재시작한 뒤에는 해당 프로세스가 online인지 확인하고 관련 HTTP 응답까지 점검합니다. 프론트엔드는 `curl -I http://127.0.0.1:3020`, 백엔드는 `curl http://127.0.0.1:8010/health`를 사용합니다.
- 문서만 수정한 경우처럼 런타임 반영이 필요 없는 변경은 PM2를 재시작하지 않습니다.

## 도메인 규칙

- 공개방은 앱에서 탐색하고 입장할 수 있습니다.
- 비공개방은 초대 코드 또는 `/join/{code}` 링크로 입장합니다.
- 사용자는 자신이 입장한 방만 접근할 수 있어야 합니다.
- 공개방 입장은 먼저 멤버십을 만든 뒤 해당 방 데이터에 접근해야 합니다.
- 후보 데이터는 방에 속하며 다른 방으로 노출되면 안 됩니다.
