# Claude Code 지침

프로젝트 작업 규칙·명령어·가드레일은 모든 에이전트 공통 가이드인 `.ai-harness/project.md`에 있다.
아래 import로 그대로 따른다 (규칙 수정은 그 파일에서만).

@.ai-harness/project.md

## Claude Code 전용 메모

- 사용자가 다른 언어를 요청하지 않는 한 응답과 작업 요약은 한글로 작성한다.
- `.claude/settings.json`·`.claude/skills/`·`.claude/agents/`는 **생성 파일**이다.
  규칙을 바꾸려면 `.agent-config/`를 고치고 `pnpm agents:sync`를 돌린다. 훅이 직접 편집을 막는다.
- 훅이 자동으로 도는 것들:
  - 편집 후 해당 패키지 타입체크와 마이그레이션 RLS 검사 (실패하면 그 자리에서 알려준다)
  - 턴 종료 시 변경된 코드 빌드 + `bolsaram-web` PM2 재시작 (빌드 실패 시 이어서 고치게 막는다)
- 사용자가 명시적으로 요청하지 않는 한 커밋, reset, 파일 폐기는 하지 않는다.
