#!/usr/bin/env bash
# Stop: 이번 턴의 코드 변경을 분류해 PM2 에 반영한다.
#   - apps/web 또는 packages/* 변경 → pnpm build 후 bolsaram-web 재시작
#   - db/migrations 새 파일        → 재시작하지 않고 안내만 (적용은 사람이 확인 후)
#   - packages/db 의 cleanup       → cron 워커라 재시작 불필요 (다음 실행에 자동 반영)
#   - ecosystem.config.cjs 변경    → pm2 에 없는 앱을 신규 등록
# 변경 수집 = PostToolUse 누적본 + 턴 시작 마커 이후 mtime 훑기(셸로 고친 파일도 잡는다).
# pm2 가 없거나 앱이 online 이 아니면 조용히 건너뛴다.
# 빌드 실패 시 stop 을 막아(decision:block) 에이전트가 이어서 고치게 한다.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
PENDING="${AGENT_PENDING_CHANGES:-$ROOT/.claude/.pending-changes}"
MARKER="${AGENT_TURN_MARKER:-$ROOT/.claude/.turn-start}"

sweep_since_marker() {
  [ -f "$MARKER" ] || return 0
  local roots=("$ROOT/apps" "$ROOT/packages" "$ROOT/db/migrations" "$ROOT/ecosystem.config.cjs")
  local exist=() r
  for r in "${roots[@]}"; do [ -e "$r" ] && exist+=("$r"); done
  [ ${#exist[@]} -eq 0 ] && return 0
  find "${exist[@]}" \
    \( -name node_modules -o -name .next -o -name __pycache__ -o -name .git \) -prune -o \
    -type f -newer "$MARKER" \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.sql' \
       -o -name 'ecosystem.config.cjs' -o -name 'package.json' \) \
    -print 2>/dev/null >> "$PENDING"
}
sweep_since_marker

# 무한 루프 방지: 이미 stop 훅으로 재진입한 상태면 block 하지 않는다.
STOP_ACTIVE=$(python3 -c '
import json,sys
try: print("1" if json.load(sys.stdin).get("stop_hook_active") else "0")
except Exception: print("0")
' 2>/dev/null || echo "0")

[ -s "$PENDING" ] || { rm -f "$PENDING" "$MARKER"; exit 0; }
mapfile -t FILES < <(sort -u "$PENDING")

NEED_WEB=0; NEED_ECOSYSTEM=0; NEW_MIGRATION=0; CLEANUP_TOUCHED=0
for f in "${FILES[@]}"; do
  case "$f" in
    */ecosystem.config.cjs)              NEED_ECOSYSTEM=1 ;;
  esac
  case "$f" in
    # 웹 앱과 그것이 의존하는 워크스페이스 패키지는 모두 재빌드 대상이다
    # (transpilePackages 로 소스를 직접 가져오므로 패키지만 고쳐도 빌드가 바뀐다).
    */apps/web/src/*|*/apps/web/next.config.ts|*/apps/web/package.json)  NEED_WEB=1 ;;
    */packages/schemas/src/*|*/packages/domain/src/*|*/packages/ui-tokens/src/*) NEED_WEB=1 ;;
    */packages/db/src/client.ts|*/packages/db/src/env.ts|*/packages/db/src/index.ts) NEED_WEB=1 ;;
  esac
  case "$f" in
    */packages/db/src/cli/cleanup.ts)    CLEANUP_TOUCHED=1 ;;
  esac
  case "$f" in
    */db/migrations/*.sql)               NEW_MIGRATION=1 ;;
  esac
done

rm -f "$PENDING" "$MARKER"

command -v pm2 >/dev/null 2>&1 || exit 0

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
  pm2 restart "$1" >/dev/null 2>&1
  sleep 2
  if is_online "$1"; then NOTES+=("✅ $2"); return 0; fi
  pm2 start "$1" >/dev/null 2>&1
  sleep 2
  if is_online "$1"; then NOTES+=("✅ $2 (재시작 끊김 → start 재시도로 복구)"); return 0; fi
  NOTES+=("🚨 $1 재시작 후에도 online 아님 — pm2 logs $1 확인 필요")
  return 1
}

BUILD_FAILED=""

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
    [ -z "$name" ] && continue
    if ! grep -qxF "$name" <<<"$PM2_NAMES"; then
      if pm2 start "$ROOT/ecosystem.config.cjs" --only "$name" >/dev/null 2>&1; then
        NOTES+=("🆕 $name pm2 신규 등록"); REGISTERED=1
      else
        NOTES+=("⚠️ $name pm2 등록 실패 — 수동 확인 필요")
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
    BUILD_FAILED="$BUILD_OUT"
  elif is_online bolsaram-web; then
    restart_app bolsaram-web "bolsaram-web 빌드+재시작"
  else
    NOTES+=("ℹ️ 빌드 성공(bolsaram-web 이 online 아님 — 재시작 생략)")
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

# 빌드 실패: stop 을 막아 이어서 고치게 한다(루프 방지 가드 포함)
if [ -n "$BUILD_FAILED" ]; then
  if [ "$STOP_ACTIVE" = "1" ]; then
    echo "❌ 빌드 실패(재진입 상태라 차단하지 않음):" >&2
    echo "$BUILD_FAILED" | tail -30 >&2
    exit 0
  fi
  touch "$MARKER"   # 이어서 고칠 파일을 다음 Stop 이 훑도록 창을 다시 연다
  REASON=$(printf 'pnpm build 실패로 bolsaram-web 을 재시작하지 못했습니다. 아래 오류를 고치세요:\n%s' "$(echo "$BUILD_FAILED" | tail -30)")
  if [ "${CODEX_HOOK:-0}" = "1" ]; then
    python3 -c 'import json,sys; print(json.dumps({"continue":False,"stopReason":sys.argv[1]}))' "$REASON"
  else
    python3 -c 'import json,sys; print(json.dumps({"decision":"block","reason":sys.argv[1]}))' "$REASON"
  fi
  exit 0
fi

[ ${#NOTES[@]} -gt 0 ] && printf '%s\n' "${NOTES[@]}" >&2
exit 0
