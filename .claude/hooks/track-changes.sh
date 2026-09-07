#!/usr/bin/env bash
# PostToolUse: 편집된 파일을 누적 기록하고(턴 종료 시 deploy-on-stop 이 소비),
# 파일이 속한 축에 맞는 프로젝트 규칙을 에이전트 컨텍스트에 주입한다.
# - 누적 기록: .claude/.pending-changes (gitignore)
# - exit 0 고정. 검증 책임은 quality-gate.sh 가 따로 담당하고 여긴 기록/상기 전용.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
PENDING="$ROOT/.claude/.pending-changes"

FILE=$(python3 -c '
import json,sys
try:
    d=json.load(sys.stdin)
    print(d.get("tool_input",{}).get("file_path",""))
except Exception:
    print("")
' 2>/dev/null || echo "")

[ -z "$FILE" ] && exit 0
echo "$FILE" >> "$PENDING"

# 어떤 축을 건드렸는지 판정한다. 여러 축에 걸리면 모두 알린다.
KINDS=""
add() { KINDS="$KINDS$1
"; }

case "$FILE" in
  */apps/web/src/app/\(member\)/*|*/apps/web/src/components/member/*)  add "member-ui" ;;
esac
case "$FILE" in
  */apps/web/src/app/admin/*|*/apps/web/src/components/admin/*)        add "admin-ui" ;;
esac
case "$FILE" in
  */apps/web/src/server/*|*/apps/web/src/app/api/*)                    add "server" ;;
esac
case "$FILE" in
  */db/migrations/*.sql)                                               add "migration" ;;
esac
case "$FILE" in
  */apps/web/src/server/ai/*|*/packages/schemas/src/extraction.ts)     add "ai" ;;
esac
case "$FILE" in
  */packages/domain/*|*/packages/schemas/*)                            add "domain" ;;
esac

[ -z "$KINDS" ] && exit 0

KINDS="$KINDS" python3 - <<'PY'
import json, os

KIND_NOTES = {
    "member-ui": (
        "📱 회원 화면을 변경했습니다. 이 서비스는 모바일에서 주로 쓰입니다.\n"
        "- 390px 폭을 먼저 만족시키고 sm:/lg: 로 확장하세요. 데스크톱만 보고 끝내지 마세요.\n"
        "- 정보 공개 범위를 지키세요 — 리스트는 익명 코드·사진·출생연도·키·직업군·지역까지,\n"
        "  이름·연락처는 INTRODUCED 이후에만. 판정은 `packages/domain/src/visibility.ts` 가 단일 소스입니다.\n"
        "- 톤: warm ivory 바탕 + serif display. 하트 남발·Tinder식 swipe 금지(설계문서 §13).\n"
        "- 사진은 단기 signed URL 이라 next/image 로 최적화하면 만료 후 깨집니다. <img> 를 그대로 쓰세요."
    ),
    "admin-ui": (
        "🗂 관리자 화면을 변경했습니다. 여기는 감성보다 CRM 밀도입니다(설계문서 §13).\n"
        "- 회원 화면 톤을 가져오지 마세요. `.admin-surface` 의 중성 팔레트를 씁니다.\n"
        "- 목록은 정보 밀도를 우선하고, 상태는 `toneForStatus()` 로 일관되게 칠하세요."
    ),
    "server": (
        "🔐 서버 코드를 변경했습니다. 이 프로젝트의 보안 규칙:\n"
        "- 일반 요청은 반드시 `withRls(ctx, ...)` 로 감쌉니다. owner 커넥션(`withOwner`)은\n"
        "  인증 경로(세션·OTP·초대 검증)에서만 쓰고, 왜 필요한지 주석으로 남기세요.\n"
        "- 권한 검사는 RLS 와 애플리케이션 레이어에 **중복**으로 둡니다. 한쪽만 믿지 마세요.\n"
        "- private 이미지의 영구 URL 을 만들지 않습니다. 응답마다 signed URL 을 새로 발급하세요.\n"
        "- 로그에 프로필 원문·사진 URL·전화번호·초대 토큰을 남기지 마세요.\n"
        "- 에러를 삼키지 말고 `DomainError` 로 던지세요. HTTP 레이어가 status 로 번역합니다."
    ),
    "migration": (
        "🗃 마이그레이션을 건드렸습니다.\n"
        "- 이미 적용된 파일은 고칠 수 없습니다(러너가 체크섬으로 거부). 새 번호 파일을 추가하세요.\n"
        "- 새 테이블에는 반드시 `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` 를 함께 넣으세요.\n"
        "- 런타임 롤 `bolsaram_app` 에 필요한 GRANT 를 잊지 마세요(기본 권한은 이후 생성분에만 적용).\n"
        "- 작성 후 `pnpm db:migrate` 로 적용하고 `npx vitest run tests/rls.test.ts` 로 정책을 확인하세요."
    ),
    "ai": (
        "🤖 AI 추출 경로를 변경했습니다.\n"
        "- 추출 스키마의 단일 소스는 `packages/schemas/src/extraction.ts` 입니다. 모델 프롬프트와\n"
        "  JSON Schema 를 따로 손대지 말고 여기서 파생시키세요.\n"
        "- 모델 raw 출력은 반드시 Zod 로 검증한 뒤에 씁니다. strict 모드라도 건너뛰지 마세요.\n"
        "- 명시되지 않은 값은 추론하지 않고 null 입니다. 프롬프트를 고치면 PROMPT_VERSION 을 올리세요.\n"
        "- AI 결과를 자동 게시하지 않습니다. 게이트는 `assertCommittable` 에 있습니다."
    ),
    "domain": (
        "🧩 도메인/스키마를 변경했습니다.\n"
        "- 상태 전이 판정은 도메인 레이어에 중앙화하고, DB 에는 조건부 UPDATE\n"
        "  (`WHERE status = <from>`)로 적용해 race condition 을 막으세요.\n"
        "- enum 을 바꾸면 `db/migrations` 의 Postgres enum 과 `packages/schemas/src/enums.ts` 를\n"
        "  **함께** 고쳐야 합니다. 한쪽만 바꾸면 런타임에 깨집니다.\n"
        "- 순수 함수는 `tests/` 에 케이스를 추가하세요. 이 계층은 테스트 비용이 가장 쌉니다."
    ),
}

kinds = [k for k in (os.environ.get("KINDS") or "").splitlines() if k]
parts = [KIND_NOTES[k] for k in dict.fromkeys(kinds) if k in KIND_NOTES]
if parts:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": "\n\n".join(parts),
        }
    }))
PY

exit 0
