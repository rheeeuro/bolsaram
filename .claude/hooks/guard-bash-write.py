#!/usr/bin/env python3
"""셸 명령이 민감 파일을 건드리는지 판정한다 (Claude·Codex 공용).

file_path 기반 가드(guard-sensitive.sh)는 Edit/Write 도구만 본다. 같은 파일을 셸로
(`sed -i`·heredoc 리다이렉션·`git apply`·python `open(...,"w")`) 고치면 그대로 통과한다.
이 모듈은 Bash 도구의 command 문자열을 세그먼트로 쪼개 **민감 경로 + 쓰기 동작**이
함께 있을 때만 차단한다(단순 조회·문자열 검색은 통과).

비밀·개인정보 경로(.env · var/storage · var/log)는 읽기도 금지라 읽기 명령에서도 막는다.
단 정규식 토큰(`"\\.env"` 같은)은 경로가 아니므로 통과시킨다.

사용: echo "$COMMAND" | guard-bash-write.py  → 차단이면 stderr 사유 + exit 2
"""

from __future__ import annotations

import re
import pathlib
import shlex
import sys

# ── 민감 대상 ────────────────────────────────────────────────────────────────
# .agent-config/sync.py 가 만들어내는 파일 — 직접 고치면 다음 동기화에 덮어써진다.
GENERATED = (
    ".claude/settings.json", ".claude/skills/", ".claude/agents/", ".agents/skills/",
    ".codex/config.toml", ".codex/hooks.json", ".codex/agents/", ".codex/rules/",
)
# 비밀·개인정보 — 읽기도 금지.
SECRETS = (".env", ".env.local")
PROTECTED_DIRS = ("var/storage", "var/log")

# 사용자가 명시적으로 요청했을 때만 비밀 파일 가드를 내린다(guard-sensitive.sh 와 같은 마커).
# 마커가 있어도 생성 설정 파일·적용된 마이그레이션 가드는 그대로 걸린다.
# guard-sensitive.sh 와 같은 경로를 봐야 한다: <repo>/.claude/.allow-secret-edit
_OVERRIDE = pathlib.Path(__file__).resolve().parent.parent / ".allow-secret-edit"


def secret_guard_off() -> bool:
    return _OVERRIDE.is_file()

# ── 쓰기 동작 ────────────────────────────────────────────────────────────────
WRITE_CMDS = {"tee", "rm", "mv", "cp", "install", "truncate", "dd", "shred", "patch", "ln"}
INPLACE_CMDS = {"sed", "perl", "ruby"}          # -i 옵션이 있을 때만
GIT_WRITE = {"apply", "checkout", "restore", "clean", "stash", "mv", "rm"}
READ_CMDS = {"cat", "head", "tail", "less", "more", "nl", "od", "xxd", "strings",
             "base64", "grep", "rg", "awk", "sed", "sort", "uniq", "cp", "scp", "diff"}
# 첫 비-옵션 인자가 검색 패턴인 명령 — 그 토큰은 경로 판정에서 뺀다.
SEARCH_CMDS = {"grep", "egrep", "fgrep", "rg", "ag", "ack"}
INTERPRETERS = {"python", "python3", "node", "npx", "tsx", "ruby", "perl", "pnpm"}
PY_WRITE_RE = re.compile(
    r"""open\s*\([^)]*['"][waxr]\+?['"]|\.write_text\s*\(|\.writelines\s*\(|"""
    r"""writeFileSync|createWriteStream|shutil\.(copy|move)|"""
    r"""os\.(remove|unlink|rename|truncate)|Path\([^)]*\)\.unlink""",
)
REDIR_RE = re.compile(r"^\d*(>>|>)\|?$")
SEGMENT_RE = re.compile(r"[;|]{1,2}|&&|\n")

PY_READ_RE = re.compile(
    r"""\.read_text\s*\(|\.read_bytes\s*\(|\.readlines\s*\(|\.read\s*\(|readFileSync|"""
    r"""open\s*\([^)]*['"]r[bt]?\+?['"]|\.iterdir\s*\(|\.exists\s*\(|\.stat\s*\(""",
)
INLINE_RE = re.compile(r"\b(?:python3?|node|npx|tsx|ruby|perl|pnpm)\b[^\n;|&]*?(?:\s-c\b|\s-e\b|<<-?\s*['\"]?\w)")
# 경로 경계에서만 잡아 `.environ`·`process.env` 같은 식별자를 피한다.
# 비밀 파일과 보호 디렉터리를 나눠 둔다 — 승인 마커는 앞엣것만 해제한다.
SECRET_FILE_RE = re.compile(r"""(?:^|[\s'"=(,/])\.env(?:\.local)?(?:$|[\s'"),;:])""")
PROTECTED_DIR_RE = re.compile(r"""(?:^|[\s'"=(,/])var/(?:storage|log)/""")

# 마이그레이션 — **이미 적용된** 파일만 수정 금지. 새 파일 작성은 정상 작업이다.
MIGRATION_RE = re.compile(r"db/migrations/(\d{4}_[\w-]+\.sql)")

_APPLIED_CACHE: set[str] | None = None


def applied_migrations() -> set[str]:
    """schema_migrations 에 기록된 파일명. DB 를 못 읽으면 빈 집합(= 차단하지 않음).

    적용 여부는 DB 가 유일한 진실이다. 파일명만 보고 막으면 새 마이그레이션 작성까지
    막히고, 파일 존재만 보면 아직 적용 안 한 초안 수정이 막힌다.
    조회 실패(컨테이너 정지 등)는 통과시킨다 — 러너의 체크섬 검사가 최종 방어선이다.
    """
    global _APPLIED_CACHE
    if _APPLIED_CACHE is not None:
        return _APPLIED_CACHE
    import subprocess

    try:
        result = subprocess.run(
            ["docker", "exec", "bolsaram_postgres", "psql", "-U", "bolsaram_owner",
             "-d", "bolsaram", "-tAc", "SELECT filename FROM schema_migrations"],
            capture_output=True, text=True, timeout=5,
        )
        _APPLIED_CACHE = (
            {line.strip() for line in result.stdout.splitlines() if line.strip()}
            if result.returncode == 0
            else set()
        )
    except Exception:
        _APPLIED_CACHE = set()
    return _APPLIED_CACHE


def migration_hit(path: str) -> str | None:
    """경로가 이미 적용된 마이그레이션이면 그 파일명."""
    m = MIGRATION_RE.search(path.replace("\\", "/"))
    if not m:
        return None
    return m.group(1) if m.group(1) in applied_migrations() else None


def classify(token: str) -> str | None:
    """토큰이 민감 경로면 차단 사유를, 아니면 None 을 돌려준다."""
    t = token.strip().strip("'\"").replace("\\", "/")
    if not t:
        return None
    name = t.rsplit("/", 1)[-1]
    if any(t.endswith(g) or (g.endswith("/") and g in t) for g in GENERATED):
        return (f"🚫 {t} 는 .agent-config/ 에서 생성되는 파일입니다.\n"
                "   스킬·에이전트·공유 설정은 .agent-config/ 원본을 고치고 sync.py 로 생성하세요.")
    if name in SECRETS and not secret_guard_off():
        return (f"🚫 {t} 는 비밀 파일입니다. 읽기·편집·커밋 금지 (.env.example 을 고치세요).\n"
                "   사용자가 명시적으로 요청했다면 .claude/.allow-secret-edit 마커로 일시 해제할 수 있습니다.")
    if any(f"{d}/" in t or t.endswith(d) for d in PROTECTED_DIRS):
        return (f"🚫 {t} 는 보호된 디렉터리입니다.\n"
                "   var/storage 는 프로필 사진(개인정보), var/log 는 운영 로그입니다. 읽기·편집 금지.")
    hit = migration_hit(t)
    if hit:
        return (f"🚫 {hit} 은 이미 적용된 마이그레이션입니다.\n"
                "   기존 파일을 고치면 러너가 체크섬 불일치로 거부합니다.\n"
                "   스키마를 바꾸려면 db/migrations/ 에 다음 번호의 새 파일을 추가하세요.")
    return None


def is_read_forbidden(token: str) -> bool:
    """읽기까지 막는 대상인지."""
    t = token.strip().strip("'\"")
    name = t.rsplit("/", 1)[-1]
    if name in SECRETS:
        return not secret_guard_off()
    return any(f"{d}/" in t or t.endswith(d) for d in PROTECTED_DIRS)


def path_like(token: str) -> bool:
    """정규식·글롭 패턴은 경로로 보지 않는다(`grep -rn "\\.env" .` 를 막지 않기 위함)."""
    t = token.strip().strip("'\"")
    return bool(t) and not any(c in t for c in "\\*?[]^$()")


def tokenize(segment: str) -> list[str]:
    try:
        return shlex.split(segment, posix=True)
    except ValueError:
        return segment.split()


def verb_of(tokens: list[str]) -> tuple[str, list[str]]:
    """앞의 env 대입·sudo 를 건너뛴 실제 명령과 인자."""
    i = 0
    while i < len(tokens) and (
        re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", tokens[i])
        or tokens[i] in {"sudo", "command", "time", "env"}
    ):
        i += 1
    if i >= len(tokens):
        return "", []
    return tokens[i].rsplit("/", 1)[-1], tokens[i + 1:]


def sensitive_text_hit(line: str) -> str | None:
    """줄 안에 민감 경로가 부분 문자열로 있으면 그 경로를 돌려준다.

    호출부는 **그 줄 자체가 쓰기일 때만** 차단한다. 경로를 문자열로 언급하는 일
    (문서·목록·주석·테스트 케이스)이 흔해서, 명령 전체에 쓰기가 하나라도 있으면
    막는 방식은 과차단이었다.

    변수에 담아 나중에 쓰는 우회는 여기서 놓칠 수 있다. 그 경우의 방어선은
    sync.py 가 생성 파일을 되돌린다는 점과, 러너의 체크섬 검사다.
    """
    norm = line.replace("\\", "/")
    for pat in GENERATED:
        if pat in norm:
            return pat
    m = MIGRATION_RE.search(norm)
    return m.group(0) if m and migration_hit(norm) else None


def check(command: str) -> str | None:
    # 1) 인터프리터 인라인 스크립트(`-c`·`-e`·heredoc)는 셸 토큰화가 스크립트를 통째로 묶으므로
    #    줄 단위 + 부분 문자열로 본다. 읽기 전용 형태면 통과, 판단 불가는 차단.
    if INLINE_RE.search(command):
        for line in command.splitlines():
            if PROTECTED_DIR_RE.search(line) or (
                SECRET_FILE_RE.search(line) and not secret_guard_off()
            ):
                return ("🚫 비밀 파일·보호된 디렉터리는 읽기·편집 금지입니다.\n"
                        "   (.env · .env.local · var/storage/ · var/log/)\n"
                        "   이 경로를 문자열로만 다뤄야 한다면(문서·테스트 케이스 등)\n"
                        "   Bash heredoc 대신 Write 도구로 파일을 만드세요.")
            hit = sensitive_text_hit(line)
            if not hit or not PY_WRITE_RE.search(line):
                continue
            return classify(hit)

    for segment in SEGMENT_RE.split(command):
        tokens = tokenize(segment)
        if not tokens:
            continue

        # 2) 리다이렉션 대상 — `> f`, `>>f`, `2> f`
        for idx, tok in enumerate(tokens):
            target = None
            if REDIR_RE.match(tok):
                target = tokens[idx + 1] if idx + 1 < len(tokens) else None
            else:
                m = re.match(r"^\d*(?:>>|>)\|?(.+)$", tok)
                if m:
                    target = m.group(1)
            if target:
                reason = classify(target)
                if reason:
                    return reason

        verb, args = verb_of(tokens)
        if not verb:
            continue

        git_write = verb == "git" and any(a in GIT_WRITE for a in args[:2])
        writes = (
            verb in WRITE_CMDS
            or (verb in INPLACE_CMDS and any(a.startswith("-i") for a in args))
            or git_write
            or (verb in INTERPRETERS and PY_WRITE_RE.search(segment) is not None)
        )
        reads = verb in READ_CMDS

        # grep/rg 의 첫 비-옵션 인자는 **검색 패턴**이지 경로가 아니다.
        # 이걸 경로로 보면 `rg "var/storage" apps/` 같은 정상 검색이 막힌다.
        scan_args = args
        if verb in SEARCH_CMDS:
            for idx, tok in enumerate(args):
                if tok.startswith("-"):
                    continue
                scan_args = args[idx + 1:]
                break
            else:
                scan_args = []

        for arg in scan_args:
            if not path_like(arg):
                continue
            if writes or (reads and is_read_forbidden(arg)):
                reason = classify(arg)
                if reason:
                    return reason
    return None


def main() -> int:
    command = (sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()).strip()
    if not command:
        return 0
    reason = check(command)
    if reason:
        print(reason, file=sys.stderr)
        print("   (셸 우회로도 같은 가드가 걸립니다 — Edit 도구와 동일 규칙)", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
