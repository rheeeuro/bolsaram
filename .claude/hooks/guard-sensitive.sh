#!/usr/bin/env bash
# PreToolUse 가드: 민감 파일 편집·열람을 차단한다.
# stdin 으로 tool 입력 JSON 을 받는다. exit 2 = 도구 호출 차단(+stderr 를 에이전트에 전달).
# Edit/Write 는 file_path 로, Bash 는 command 문자열로 판정한다 — 셸(sed -i·heredoc·
# git apply)로 우회 편집하면 file_path 가 없어 그대로 통과하던 구멍을 막는다.
#
# 비밀 파일 가드는 사용자가 명시적으로 요청할 때만 내린다.
#   touch .claude/.allow-secret-edit    # 승인
#   rm    .claude/.allow-secret-edit    # 즉시 복구 (작업이 끝나면 반드시)
# 마커가 있어도 생성 설정 파일·적용된 마이그레이션 가드는 그대로 걸린다.
# 에이전트가 스스로 이 마커를 만들지 않는다 — 사용자 지시가 있을 때만이다.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
SECRET_OVERRIDE="$ROOT/.claude/.allow-secret-edit"
INPUT=$(cat)

FILE=$(printf '%s' "$INPUT" | python3 -c '
import json,sys
try:
    d=json.load(sys.stdin)
    print(d.get("tool_input",{}).get("file_path",""))
except Exception:
    print("")
' 2>/dev/null || echo "")

if [ -z "$FILE" ]; then
  # Bash 경로 — 판정 기준은 guard-bash-write.py 가 단일 소스(Claude·Codex 공용)
  CMD=$(printf '%s' "$INPUT" | python3 -c '
import json,sys
try:
    d=json.load(sys.stdin)
    print(d.get("tool_input",{}).get("command",""))
except Exception:
    print("")
' 2>/dev/null || echo "")
  [ -z "$CMD" ] && exit 0
  printf '%s' "$CMD" | python3 "$ROOT/.claude/hooks/guard-bash-write.py" || exit 2
  exit 0
fi

case "$FILE" in
  */.claude/settings.json|*/.claude/skills/*|*/.claude/agents/*|*/.agents/skills/*|\
  */.codex/config.toml|*/.codex/hooks.json|*/.codex/agents/*|*/.codex/rules/*)
    echo "🚫 $FILE 는 .agent-config/ 에서 생성되는 파일입니다." >&2
    echo "   스킬·에이전트·공유 설정은 .agent-config/ 원본을 수정한 뒤 sync.py 를 돌리세요." >&2
    exit 2
    ;;
  */.env|*/.env.local)
    if [ -f "$SECRET_OVERRIDE" ]; then
      echo "⚠️  비밀 파일 가드가 해제된 상태입니다($FILE). 작업이 끝나면 마커를 지우세요:" >&2
      echo "   rm .claude/.allow-secret-edit" >&2
      exit 0
    fi
    echo "🚫 $FILE 는 비밀 파일입니다. 편집·커밋 금지." >&2
    echo "   환경변수 항목을 추가하려면 .env.example 을 고치고 사용자에게 값을 요청하세요." >&2
    echo "   사용자가 명시적으로 요청했다면 .claude/.allow-secret-edit 마커로 일시 해제할 수 있습니다." >&2
    exit 2
    ;;
  */var/storage/*)
    echo "🚫 $FILE 는 프로필 사진(개인정보) 저장소입니다. 직접 열람·편집 금지." >&2
    echo "   파일 조작이 필요하면 apps/web/src/server/storage/local.ts 의 API 를 쓰세요." >&2
    exit 2
    ;;
  */var/log/*)
    echo "🚫 $FILE 는 운영 로그입니다. 직접 편집 금지 (조회는 pm2 logs 를 쓰세요)." >&2
    exit 2
    ;;
esac

# ── 적용된 마이그레이션 보호 ─────────────────────────────────────────────
# 러너가 체크섬으로 막지만, 여기서 먼저 차단해 "고쳤는데 안 먹는" 혼란을 없앤다.
case "$FILE" in
  */db/migrations/*.sql)
    BASENAME="${FILE##*/}"
    APPLIED=$(docker exec bolsaram_postgres psql -U bolsaram_owner -d bolsaram -tAc \
      "SELECT 1 FROM schema_migrations WHERE filename = '$BASENAME'" 2>/dev/null | tr -d '[:space:]')
    if [ "$APPLIED" = "1" ]; then
      echo "🚫 $BASENAME 은 이미 적용된 마이그레이션입니다." >&2
      echo "   기존 파일을 고치면 러너가 체크섬 불일치로 거부합니다." >&2
      echo "   스키마를 바꾸려면 db/migrations/ 에 다음 번호의 새 파일을 추가하세요." >&2
      exit 2
    fi
    ;;
esac

exit 0
