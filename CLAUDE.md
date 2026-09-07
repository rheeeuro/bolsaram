# Claude Code 지침

이 저장소에서 작업하기 전에 `.ai-harness/project.md`를 읽고 따릅니다.

Claude Code 전용 메모:

- 사용자가 다른 언어를 요청하지 않는 한 응답과 작업 요약은 한글로 작성합니다.
- 사용자가 명시적으로 요청하지 않는 한 커밋, reset, 파일 폐기는 하지 않습니다.
- 마무리 전에 `pnpm verify`(typecheck + lint + test)를 실행합니다. DB 통합 테스트가 있으므로 `pnpm db:up`이 필요합니다.
- 이 호스트에는 다른 프로젝트의 서버도 떠 있습니다. `pkill -f next` 같은 광범위한 종료 명령 대신 PID를 지정합니다.
- 적용이 끝난 `db/migrations/*.sql`은 수정하지 않고 새 파일을 추가합니다(러너가 체크섬으로 막습니다).
