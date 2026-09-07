# Codex 지침

이 저장소에서 작업하기 전에 `.ai-harness/project.md`를 읽고 따릅니다.

Codex 전용 메모:

- 파일 검색은 가능하면 `rg` 또는 `rg --files`를 사용합니다. 사용할 수 없으면 단순한 셸 명령으로 확인합니다.
- 환경이 허용하면 파일 수정에는 `apply_patch`를 우선 사용합니다.
- 진행 상황은 짧게 한글로 공유합니다.
- 마무리 전에 `pnpm verify`(typecheck + lint + test)를 실행합니다. DB 통합 테스트가 있으므로 `pnpm db:up`이 필요합니다.
- 적용이 끝난 `db/migrations/*.sql`은 수정하지 않고 새 파일을 추가합니다.
