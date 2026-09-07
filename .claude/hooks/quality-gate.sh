#!/usr/bin/env bash
# PostToolUse 품질 게이트: 편집된 파일 종류에 맞춰 빠른 검증을 돌린다.
# exit 2 = 실패를 에이전트에 피드백(stderr). exit 0 = 통과/대상 아님.
# 전체 검증(pnpm verify)은 느리므로 여기서는 해당 패키지만 좁혀 본다.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

FILE=$(python3 -c '
import json,sys
try:
    d=json.load(sys.stdin)
    print(d.get("tool_input",{}).get("file_path",""))
except Exception:
    print("")
' 2>/dev/null || echo "")

[ -z "$FILE" ] && exit 0

# 파일이 속한 워크스페이스 패키지를 찾는다.
pkg_of() {
  case "$1" in
    "$ROOT"/apps/web/*)          echo "@bolsaram/web" ;;
    "$ROOT"/packages/schemas/*)  echo "@bolsaram/schemas" ;;
    "$ROOT"/packages/domain/*)   echo "@bolsaram/domain" ;;
    "$ROOT"/packages/db/*)       echo "@bolsaram/db" ;;
    "$ROOT"/packages/ui-tokens/*) echo "@bolsaram/ui-tokens" ;;
    *) echo "" ;;
  esac
}

case "$FILE" in
  *.ts|*.tsx)
    # tests/ 는 루트 tsconfig 가 없으므로 vitest 가 잡는다 — 여기서는 건너뛴다.
    case "$FILE" in "$ROOT"/tests/*) exit 0 ;; esac
    PKG=$(pkg_of "$FILE")
    [ -z "$PKG" ] && exit 0
    OUT=$(cd "$ROOT" && pnpm --filter "$PKG" typecheck 2>&1)
    if [ $? -ne 0 ]; then
      echo "❌ 타입 체크 실패 ($PKG):" >&2
      echo "$OUT" | grep -vE '^\s*$|^>' | tail -25 >&2
      exit 2
    fi
    ;;

  *.sql)
    # 마이그레이션은 문법만 본다(실행하지 않는다). 적용은 사람이 pnpm db:migrate 로 한다.
    case "$FILE" in
      "$ROOT"/db/migrations/*)
        # RLS 를 켜면서 정책을 안 만든 테이블은 아무도 못 읽게 되어 조용히 깨진다.
        if grep -q "ENABLE ROW LEVEL SECURITY" "$FILE" && ! grep -q "CREATE POLICY" "$FILE"; then
          echo "⚠️  $FILE 이 RLS 를 켜지만 CREATE POLICY 가 없습니다." >&2
          echo "   정책 없는 테이블은 bolsaram_app 롤이 전혀 읽지 못합니다." >&2
          echo "   의도한 것이면(인증 전용 테이블) REVOKE 로 의도를 명시하세요." >&2
          exit 2
        fi
        # 새 테이블을 만들면서 RLS 를 안 켜면 정책 없이 열려버린다.
        if grep -qiE "^\s*CREATE TABLE" "$FILE" && ! grep -q "ROW LEVEL SECURITY" "$FILE"; then
          echo "⚠️  $FILE 이 테이블을 만들지만 RLS 설정이 없습니다." >&2
          echo "   설계문서 §12 는 모든 테이블에 RLS 를 요구합니다." >&2
          echo "   같은 파일이나 후속 마이그레이션에서 ENABLE ROW LEVEL SECURITY + CREATE POLICY 를 넣으세요." >&2
          exit 2
        fi
        ;;
    esac
    ;;
esac

exit 0
