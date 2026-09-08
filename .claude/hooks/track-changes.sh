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
# 사용자에게 보이는 동작·정책이 바뀔 수 있는 축. 가이드 동기화를 상기시킨다.
# 로그인·가입·초대 링크 화면은 (member)/admin 어느 그룹에도 없다 — 빠뜨리면
# 회원이 처음 만나는 화면이 문서와 어긋난 채로 남는다(실제로 그랬다, 2026-09-08).
case "$FILE" in
  */apps/web/src/app/\(member\)/*|*/apps/web/src/components/member/*|\
  */apps/web/src/app/admin/*|*/apps/web/src/components/admin/*|\
  */apps/web/src/app/login/*|*/apps/web/src/app/signup/*|*/apps/web/src/app/claim/*|\
  */apps/web/src/server/auth/*|*/apps/web/src/server/telegram/messages.ts|\
  */packages/schemas/src/enums.ts|*/packages/schemas/src/auth.ts|\
  */packages/domain/src/visibility.ts|*/packages/db/src/cleanup.ts|\
  */apps/web/src/server/storage/local.ts|*/ecosystem.config.cjs)       add "user-guide" ;;
esac
# 가이드를 직접 고쳤을 때도 검증을 상기시킨다.
case "$FILE" in
  */docs/guide/*.md)                                                   add "guide-edit" ;;
esac

# 디렉터리 README 동기화. 파일을 추가·삭제·이동하면 그 디렉터리 문서를 함께 고쳐야 한다.
# 어느 README 를 봐야 하는지 파일 경로로 정해준다.
README=""
case "$FILE" in
  */apps/web/src/*)          README="apps/web/README.md" ;;
  */packages/schemas/src/*)  README="packages/schemas/README.md" ;;
  */packages/domain/src/*)   README="packages/domain/README.md" ;;
  */packages/db/src/*)       README="packages/db/README.md" ;;
  */packages/ui-tokens/src/*) README="packages/ui-tokens/README.md" ;;
  */db/migrations/*.sql)     README="db/README.md" ;;
  */tests/*.test.ts)         README="tests/README.md" ;;
esac
[ -n "$README" ] && add "dir-readme"

# 이력성 주석 경고(경고 전용, 차단하지 않음). 판정 기준은 history-comment-check.py 가 단일 소스.
HISTORY_WARN=$(python3 "$ROOT/.claude/hooks/history-comment-check.py" "$FILE" 2>/dev/null || echo "")

[ -z "$KINDS" ] && [ -z "$HISTORY_WARN" ] && exit 0

KINDS="$KINDS" README="$README" HISTORY_WARN="$HISTORY_WARN" python3 - <<'PY'
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
    "user-guide": (
        "📖 사용자에게 보이는 동작·정책을 건드렸을 수 있습니다.\n"
        "- `docs/guide/` 는 회원과 주선자가 읽는 문서입니다. 화면 흐름·버튼·정책 숫자\n"
        "  (인증번호 유효시간, 초대 기간, 업로드 상한, 상태 이름 등)가 바뀌었다면\n"
        "  **이번 턴에 함께 고치세요.** 코드와 문서가 어긋난 채로 완료 보고하지 않습니다.\n"
        "- 어긋나면 `npx vitest run tests/docs-guide.test.ts` 가 실패합니다. 이 테스트가\n"
        "  검증하는 사실을 바꿨다면 가이드와 테스트를 같이 고칩니다.\n"
        "- 문서는 사용자 입장으로 씁니다 — 파일 경로·함수명이 아니라 화면과 버튼으로 설명합니다."
    ),
    "guide-edit": (
        "📖 사용자 가이드를 고쳤습니다.\n"
        "- `npx vitest run tests/docs-guide.test.ts` 로 코드와 어긋나지 않는지 확인하세요.\n"
        "- 새 화면을 안내했다면 그 경로가 실제로 있는지 테스트가 확인합니다.\n"
        "- 개발자용 설명(파일 경로·내부 구조)은 `docs/` 상위나 `.ai-harness/project.md` 로 보냅니다."
    ),
    "dir-readme": (
        "📄 `{README}` 는 이 디렉터리의 **현재 구조** 소스 오브 트루스입니다.\n"
        "- 아직 안 읽었다면 먼저 읽어 구조·불변식·주의점을 확인하세요.\n"
        "- 파일을 추가·삭제·이동했거나 책임·흐름이 바뀌었다면 **이번 턴에 함께 갱신**하세요.\n"
        "  코드와 문서가 어긋난 채로 완료 보고하지 않습니다.\n"
        "- 어긋나면 `npx vitest run tests/docs-readme.test.ts` 가 실패합니다\n"
        "  (없는 파일을 설명하거나, 있는 파일을 빠뜨리면 잡힙니다).\n"
        "- README 에는 **현재 상태**만 씁니다. 왜 그렇게 됐는지·언제 바꿨는지 같은 이력은 쓰지 않습니다."
    ),
}

kinds = [k for k in (os.environ.get("KINDS") or "").splitlines() if k]
parts = [KIND_NOTES[k] for k in dict.fromkeys(kinds) if k in KIND_NOTES]
readme = os.environ.get("README") or ""
parts = [p.replace("{README}", readme) for p in parts]
warn = (os.environ.get("HISTORY_WARN") or "").strip()
if warn:
    parts.append(warn)
if parts:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": "\n\n".join(parts),
        }
    }))
PY

exit 0
