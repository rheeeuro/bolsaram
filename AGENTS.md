# Codex 지침

프로젝트 작업 규칙·명령어·가드레일은 모든 에이전트 공통 가이드인 `.ai-harness/project.md`에 있다.
작업 전에 그 파일을 읽고 따른다 (규칙 수정도 그 파일에서만).

## Codex 전용 메모

- 파일 검색은 가능하면 `rg` 또는 `rg --files`를 쓴다. 없으면 단순한 셸 명령으로 확인한다.
- 환경이 허용하면 파일 수정에는 `apply_patch`를 우선 쓴다.
- 진행 상황은 짧게 한글로 공유한다.
- `.codex/config.toml`·`.codex/hooks.json`·`.codex/agents/`·`.codex/rules/`는 **생성 파일**이다.
  규칙을 바꾸려면 `.agent-config/`를 고치고 `python3 .agent-config/sync.py`를 돌린다.
- 마무리 전에 `pnpm verify`를 실행한다. DB 통합 테스트가 있으므로 `pnpm db:up`이 필요하다.
