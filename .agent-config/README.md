# 에이전트 하네스 원본

Claude와 Codex 설정을 함께 생성하는 소스 오브 트루스입니다.
작업 규칙은 [공통 프로젝트 지침](../.ai-harness/project.md)을 따릅니다.

## 구성

- `manifest.json`: 공용 훅 기능과 권한 설정.
- `sync.py`: 두 도구의 설정·스킬·에이전트·규칙 생성. 배포 시작·종료 이벤트를 공통 함수로 정의합니다.
- `deploy-state.py`: 배포 대상 파일의 수정 시각·크기 비교. 추가·삭제·셸 편집을 감지합니다.
- `hook-files.py`: Claude의 `file_path`와 Codex 패치의 추가·수정·이동·삭제 경로 추출.
- `guard-cases.py`: 셸 가드 회귀 테스트.
- `deploy-cases.py`: 임시 프로젝트와 가짜 PM2·pnpm·curl을 사용하는 배포 회귀 테스트.
- `skills/`, `agents/`: 두 도구에 배포하는 스킬·역할 원본.

실행 스크립트는 [공용 훅 디렉터리](../.claude/hooks)에 있습니다.
생성 대상인 `.claude/settings.json`, `.codex/hooks.json`, `.codex/config.toml`은 직접 수정하지 않습니다.

## 검증

```bash
pnpm agents:sync
pnpm agents:check
pnpm agents:test
pnpm verify
```

자동 배포 테스트는 운영 PM2나 네트워크를 사용하지 않습니다. 생성된 양쪽 설정,
환경변수 변경, 파일 삭제, R2 모듈 변경, 빌드·PM2·HTTP 실패와 재시도,
중지된 앱 보존, 동시 배포 방지, 중복 배포 생략을 확인합니다.

`.claude/.deploy-state.json`과 잠금·대기 파일은 Git에 포함하지 않습니다.
상태에는 파일명과 메타데이터만 남기며 `.env` 값은 저장하지 않습니다.
공용 스크립트를 직접 호출할 때도 같은 상태와 잠금을 사용합니다.
