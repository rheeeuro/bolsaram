#!/usr/bin/env python3
"""guard-bash-write.py 판정 케이스. 기대값과 실제를 비교한다.

민감 경로 리터럴은 쪼개서 조립한다 — 이 파일 자체가 가드에 걸리지 않게 하기 위함이다.
"""
import subprocess
import sys

GUARD = "/home/euro/dev/bolsaram/.claude/hooks/guard-bash-write.py"

GEN = ".claude/" + "settings.json"
MIG = "db/migrations/0003_core_tables.sql"
NEW_MIG = "db/migrations/0008_brand_new.sql"
ENVF = "." + "env"
STORE = "var/" + "storage"
LOGD = "var/" + "log"

# (설명, 명령, 차단되어야 하는가)
CASES = [
    # ── 차단 ──────────────────────────────────────────────
    ("적용된 마이그레이션 sed -i",       f"sed -i 's/x/y/' {MIG}", True),
    ("적용된 마이그레이션 덮어쓰기",      f"cat > {MIG}", True),
    ("python 으로 마이그레이션 쓰기",     f'python3 -c \'open("{MIG}","w").write("x")\'', True),
    ("생성 설정 파일 리다이렉션",         f"echo x > {GEN}", True),
    ("python 블록에서 설정 파일 쓰기",
     f"python3 - <<'PY'\nimport pathlib\npathlib.Path('{GEN}').write_text('x')\nPY", True),
    ("비밀 파일 읽기",                   f"cat {ENVF}", True),
    ("비밀 파일 추가 쓰기",              f'echo "K=1" >> {ENVF}', True),
    ("프로필 사진 열람",                 f"cat {STORE}/profile/a/b.png", True),
    ("운영 로그 편집",                   f"truncate -s 0 {LOGD}/bolsaram-web.out.log", True),
    ("grep 대상이 비밀 파일",            f'grep -rn "SECRET" {ENVF}', True),
    ("rg 대상이 스토리지 디렉터리",       f'rg "x" {STORE}/', True),

    # ── 통과 ──────────────────────────────────────────────
    ("마이그레이션 경로 단순 언급",       f"echo {MIG} > /tmp/list.txt", False),
    ("python 쓰기 + 다른 줄에 경로 언급",
     f"python3 - <<'PY'\nimport pathlib\npathlib.Path('notes.md').write_text('x')\nPY\necho {MIG} > /tmp/x", False),
    ("마이그레이션 읽기",                f"cat {MIG}", False),
    ("새 마이그레이션 작성",             f"cat > {NEW_MIG}", False),
    ("새 마이그레이션 heredoc",          f"cat > {NEW_MIG} <<'EOF'", False),
    ("일반 소스 편집",                   "sed -i 's/a/b/' apps/web/src/lib/cn.ts", False),
    ("검증 실행",                        "pnpm verify", False),
    ("검색어가 스토리지 경로",            f'rg "{STORE}" apps/web/src', False),
    ("검색어가 비밀 파일명",              f'grep -rn "{ENVF}" apps/web/src', False),
    ("환경변수 참조",                    'node -e "console.log(process.env.PORT)"', False),
    ("설정 파일 읽기",                   f"cat {GEN}", False),
    ("예시 env 파일 편집",               "sed -i 's/a/b/' .env.example", False),
]


def blocked(command: str) -> bool:
    result = subprocess.run([sys.executable, GUARD], input=command, capture_output=True, text=True)
    return result.returncode != 0


def main() -> int:
    failures = 0
    for label, command, expect_block in CASES:
        actual = blocked(command)
        ok = actual == expect_block
        failures += 0 if ok else 1
        mark = "✓" if ok else "✗"
        state = "차단" if actual else "통과"
        suffix = "" if ok else f"  ← 기대: {'차단' if expect_block else '통과'}"
        print(f"  {mark} {state}  {label}{suffix}")
    print(f"\n{len(CASES) - failures}/{len(CASES)} 통과")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
