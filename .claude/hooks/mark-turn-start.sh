#!/usr/bin/env bash
# UserPromptSubmit: 이번 턴의 시작 시각을 마커 파일로 남긴다(내용 없음 — mtime 만 쓴다).
# deploy-on-stop 이 이 시각 이후에 바뀐 소스를 훑어, 셸(sed·heredoc·git apply)로 고쳐
# PostToolUse(Edit|Write) 에 안 잡힌 파일까지 배포 대상에 넣는다.
# 아직 소비되지 않은 마커가 있으면 그대로 둔다(중단된 턴의 변경을 잃지 않게).
# stdout 은 에이전트 컨텍스트로 주입되므로 아무것도 출력하지 않는다.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
MARKER="${AGENT_TURN_MARKER:-$ROOT/.claude/.turn-start}"

[ -f "$MARKER" ] || : > "$MARKER"
exit 0
