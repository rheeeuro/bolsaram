#!/usr/bin/env bash
# UserPromptSubmit: 최초 비교 기준과 턴 마커를 준비한다.
# 마지막 성공 상태를 유지하므로 턴 사이의 변경과 중단된 배포를 잃지 않는다.
# stdout은 에이전트 컨텍스트로 주입되므로 아무것도 출력하지 않는다.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
MARKER="${AGENT_TURN_MARKER:-$ROOT/.claude/.turn-start}"

STATE="${AGENT_DEPLOY_STATE:-$ROOT/.claude/.deploy-state.json}"
LOCK="${AGENT_DEPLOY_LOCK:-$ROOT/.claude/.deploy.lock}"
mkdir -p "$(dirname "$MARKER")" "$(dirname "$LOCK")"
exec 9>"$LOCK"
# 다른 도구가 배포 중이면 그 배포가 기준 상태를 남긴다.
flock -n 9 || exit 0
python3 "$ROOT/.agent-config/deploy-state.py" init "$ROOT" "$STATE" || exit 2
[ -f "$MARKER" ] || : > "$MARKER"
exit 0
