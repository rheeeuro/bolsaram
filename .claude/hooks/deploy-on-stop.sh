#!/usr/bin/env bash
# Stop: 이번 턴의 코드 변경을 분류해 PM2 에 반영한다.
#   - apps/web 또는 packages/* 변경 → pnpm build 후 bolsaram-web 재시작
#   - db/migrations 새 파일        → 재시작하지 않고 안내만 (적용은 사람이 확인 후)
#   - packages/db 의 cleanup       → cron 워커라 재시작 불필요 (다음 실행에 자동 반영)
#   - ecosystem.config.cjs 변경    → pm2 에 없는 앱을 신규 등록
# 변경 수집 = PostToolUse 누적본 + 마지막 반영 상태와 파일 메타데이터 비교.
# PM2가 없거나 앱이 online이 아니면 대기 상태를 보존한다.
# 빌드 실패 시 stop 을 막아(decision:block) 에이전트가 이어서 고치게 한다.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
PENDING="${AGENT_PENDING_CHANGES:-$ROOT/.claude/.pending-changes}"
MARKER="${AGENT_TURN_MARKER:-$ROOT/.claude/.turn-start}"

STATE="${AGENT_DEPLOY_STATE:-$ROOT/.claude/.deploy-state.json}"
LOCK="${AGENT_DEPLOY_LOCK:-$ROOT/.claude/.deploy.lock}"
mkdir -p "$(dirname "$STATE")" "$(dirname "$LOCK")" "$(dirname "$PENDING")"
exec 9>"$LOCK"
# Claude와 Codex가 같은 Next 빌드 디렉터리를 동시에 갱신하지 않는다.
flock -n 9 || { echo "배포가 이미 진행 중입니다. 변경 상태는 다음 Stop에서도 확인합니다." >&2; exit 0; }
SNAPSHOT=$(mktemp "$STATE.next.XXXXXX")
trap 'rm -f "$SNAPSHOT"' EXIT
python3 "$ROOT/.agent-config/deploy-state.py" diff "$ROOT" "$STATE" "$SNAPSHOT" >> "$PENDING" || exit 2

# 무한 루프 방지: 이미 stop 훅으로 재진입한 상태면 block 하지 않는다.
STOP_ACTIVE=$(python3 -c '
import json,sys
try: print("1" if json.load(sys.stdin).get("stop_hook_active") else "0")
except Exception: print("0")
' 2>/dev/null || echo "0")

[ -s "$PENDING" ] || { mv "$SNAPSHOT" "$STATE"; rm -f "$PENDING" "$MARKER"; exit 0; }
mapfile -t FILES < <(sort -u "$PENDING")

NEED_WEB=0; NEED_HEALTH=0; NEED_ECOSYSTEM=0; NEW_MIGRATION=0; CLEANUP_TOUCHED=0
for f in "${FILES[@]}"; do
  case "$f" in
    */ecosystem.config.cjs)              NEED_ECOSYSTEM=1 ;;
  esac
  case "$f" in
    "$ROOT"/.env|"$ROOT"/.env.local)
      NEED_WEB=1; NEED_HEALTH=1 ;;
    "$ROOT"/scripts/health-watch.ts)
      NEED_HEALTH=1 ;;
    "$ROOT"/packages/db/src/cli/dotenv.ts)
      NEED_HEALTH=1; CLEANUP_TOUCHED=1 ;;
    "$ROOT"/packages/db/src/cli/*|"$ROOT"/packages/db/src/cleanup.ts)
      CLEANUP_TOUCHED=1 ;;
    "$ROOT"/apps/web/*|"$ROOT"/packages/*)
      NEED_WEB=1 ;;
    "$ROOT"/package.json|"$ROOT"/pnpm-lock.yaml|"$ROOT"/pnpm-workspace.yaml)
      NEED_WEB=1 ;;
  esac
  case "$f" in
    */db/migrations/*.sql)               NEW_MIGRATION=1 ;;
  esac
done

command -v pm2 >/dev/null 2>&1 || { echo "PM2 없음 — 배포 대기 상태를 보존합니다." >&2; exit 0; }

is_online() {
  pm2 jlist 2>/dev/null | python3 -c '
import json,sys
name=sys.argv[1]
try: apps=json.load(sys.stdin)
except Exception: sys.exit(1)
for a in apps:
    if a.get("name")==name and a.get("pm2_env",{}).get("status")=="online":
        sys.exit(0)
sys.exit(1)
' "$1"
}

NOTES=()

# pm2 restart 는 stop→start 2단계라 중간에 끊기면 앱이 stopped 로 방치된다.
# 재시작 후 online 을 확인하고, 아니면 start 로 한 번 더 살린다.
restart_app() {
  if pm2 restart "$1" >/dev/null 2>&1; then
    sleep 2
    if is_online "$1"; then NOTES+=("✅ $2"); return 0; fi
  fi
  if pm2 start "$1" >/dev/null 2>&1; then
    sleep 2
    if is_online "$1"; then NOTES+=("✅ $2 (start 재시도로 복구)"); return 0; fi
  fi
  NOTES+=("🚨 $1 재시작 실패")
  return 1
}

FAILURE=""
DEFERRED=0

# 0) ecosystem 변경: pm2 에 아직 없는 앱을 등록한다.
if [ "$NEED_ECOSYSTEM" = "1" ]; then
  ECO_NAMES=$(node -e 'try{const a=require(process.argv[1]).apps||[];console.log(a.map(x=>x.name).join("\n"))}catch(e){}' "$ROOT/ecosystem.config.cjs" 2>/dev/null)
  PM2_NAMES=$(pm2 jlist 2>/dev/null | python3 -c '
import json,sys
try: apps=json.load(sys.stdin)
except Exception: apps=[]
print("\n".join(a.get("name","") for a in apps))
')
  REGISTERED=0
  while IFS= read -r name; do
    case "$name" in bolsaram-*) ;; *) continue ;; esac
    if ! grep -qxF "$name" <<<"$PM2_NAMES"; then
      if pm2 start "$ROOT/ecosystem.config.cjs" --only "$name" >/dev/null 2>&1; then
        NOTES+=("🆕 $name pm2 신규 등록"); REGISTERED=1
      else
        FAILURE="$name PM2 등록 실패"
      fi
    fi
  done <<<"$ECO_NAMES"
  [ "$REGISTERED" = "1" ] && pm2 save >/dev/null 2>&1 && NOTES+=("💾 pm2 save 완료")
fi

# 1) 웹: 빌드 후 재시작. Next 는 .next 산출물을 읽으므로 빌드가 먼저다.
if [ "$NEED_WEB" = "1" ]; then
  echo "🛠  웹 코드 변경 감지 → pnpm build" >&2
  BUILD_OUT=$(cd "$ROOT" && pnpm build 2>&1)
  if [ $? -ne 0 ]; then
    FAILURE="pnpm build 실패:
$(echo "$BUILD_OUT" | tail -30)"
  elif is_online bolsaram-web; then
    if ! restart_app bolsaram-web "bolsaram-web 빌드+재시작"; then
      FAILURE="bolsaram-web 재시작 실패"
    else
      # online이어도 설정 오류로 모든 요청이 500일 수 있으므로 실제 HTTP를 확인한다.
      HEALTHY=0
      for attempt in {1..15}; do
        if curl --fail --silent --max-time 3 --output /dev/null http://127.0.0.1:3020/api/health; then
          HEALTHY=1; break
        fi
        sleep 2
      done
      if [ "$HEALTHY" = "1" ]; then
        NOTES+=("✅ /api/health 정상")
      else
        FAILURE="재시작 후 /api/health가 정상 응답하지 않습니다. 설정과 DB 상태를 확인하세요."
      fi
    fi
  else
    NOTES+=("ℹ️ 빌드 성공(bolsaram-web 이 online 아님 — 재시작 생략, 대기 상태 보존)")
    DEFERRED=1
  fi
fi

# .env를 기동 때 읽는 상시 감시기도 함께 갱신한다. cron 작업은 다음 실행에 읽는다.
if [ "$NEED_HEALTH" = "1" ] && [ -z "$FAILURE" ]; then
  if is_online bolsaram-health; then
    restart_app bolsaram-health "bolsaram-health 설정 반영" || FAILURE="bolsaram-health 재시작 실패"
  else
    NOTES+=("ℹ️ bolsaram-health가 online이 아니므로 재시작 생략")
  fi
fi

# 2) cron 워커: 재시작하지 않는다(매 실행 새 프로세스로 뜬다).
[ "$CLEANUP_TOUCHED" = "1" ] && NOTES+=("⏰ bolsaram-cleanup 변경됨 — cron 워커라 재시작 불필요(다음 04:10 실행에 반영)")

# 3) 마이그레이션: 자동 적용하지 않는다. 스키마 변경은 되돌리기 어려워 사람이 확인한다.
if [ "$NEW_MIGRATION" = "1" ]; then
  UNAPPLIED=$(cd "$ROOT" && python3 - <<'PY' 2>/dev/null || true
import subprocess, pathlib
d = pathlib.Path("db/migrations")
files = sorted(p.name for p in d.glob("*.sql")) if d.is_dir() else []
try:
    out = subprocess.run(
        ["docker", "exec", "bolsaram_postgres", "psql", "-U", "bolsaram_owner", "-d", "bolsaram",
         "-tAc", "SELECT filename FROM schema_migrations"],
        capture_output=True, text=True, timeout=5)
    applied = {l.strip() for l in out.stdout.splitlines() if l.strip()} if out.returncode == 0 else set()
except Exception:
    applied = set()
pending = [f for f in files if f not in applied]
print(" ".join(pending))
PY
)
  if [ -n "${UNAPPLIED// /}" ]; then
    NOTES+=("🗃 미적용 마이그레이션: ${UNAPPLIED} — \`pnpm db:migrate\` 로 적용하세요(자동 적용 안 함)")
  fi
fi

# 실패한 변경은 다음 Stop에서도 다시 시도할 수 있도록 상태와 대기 목록을 보존한다.
if [ -n "$FAILURE" ]; then
  if [ "$STOP_ACTIVE" = "1" ]; then
    python3 -c 'import json,sys; print(json.dumps({"systemMessage":sys.argv[1]}))' "$FAILURE"
  else
    python3 -c 'import json,sys; print(json.dumps({"decision":"block","reason":sys.argv[1]}))' "$FAILURE"
  fi
  exit 0
fi

if [ "$DEFERRED" = "0" ]; then
  # 빌드 시작 때의 상태를 기록해 빌드 도중 생긴 변경을 다음 Stop에서 다시 감지한다.
  mv "$SNAPSHOT" "$STATE"
  rm -f "$PENDING" "$MARKER"
fi
[ ${#NOTES[@]} -gt 0 ] && printf '%s\n' "${NOTES[@]}" >&2
exit 0
