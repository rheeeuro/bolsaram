#!/usr/bin/env python3
"""편집한 파일에 **이력성 주석**이 새로 들어갔는지 검사한다 (경고 전용, 차단하지 않음).

규칙(`.ai-harness/project.md` 「세 계층을 구분한다」):
  코드 주석                    = 지금 이 코드가 하는 일과 그렇게 한 이유 한두 줄
  디렉터리 README              = 현재 구조·불변식·주의점
  docs/implementation-plan.md  = 언제 무엇을 왜 바꿨는지(이력), 설계와 다르게 간 결정

세 계층을 글로만 정해두면 이력이 슬금슬금 코드와 README 로 샌다. 새로 추가된 줄만
보므로 기존 주석은 건드리지 않는다.

Claude(.claude/hooks/track-changes.sh)와 Codex 가 이 파일을 공유해 같은 판정을 쓴다.
패턴을 고칠 땐 여기만 고친다.

사용법: python3 history-comment-check.py <file> [file...]
  → 이력성 주석이 새로 추가됐으면 경고 문구를 stdout 으로 출력(없으면 무출력). 항상 exit 0.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

# 검사 대상 — 코드 파일만.
# 마이그레이션(.sql)은 그 자체가 번호 박힌 이력 산출물이라 애초에 대상이 아니다.
CODE_SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".py"}
SKIP_PARTS = {"node_modules", ".next", "__pycache__", "dist", "tests", "docs", ".claude", ".codex"}

COMMENT_HEAD = re.compile(r'^\s*(#|//|/\*|\*|"""|\'\'\')')
# 줄 끝 주석(`const X = 1; // 예전엔 2`)도 같은 규칙을 받는다.
COMMENT_TAIL = re.compile(r"\s(#|//)\s")

# ① 변경 서사 — "예전엔 X 였다 / 제거했다 / 되돌렸다"
# 어미까지 붙여 좁힌다. `롤백한다`(DB 동작)·`바꿨다면`(조건문 서술)은 이력이 아니다.
NARRATIVE = re.compile(
    r"(예전엔|예전에는|예전 |이전엔|이전에는|과거엔|종전의|원래는"
    r"|제거했|삭제했|폐지했|되돌렸|되돌림|롤백했|교체했|전환했|재도입했|재설계했"
    r"|바꿨다(?![면가])|바꿨습니다|없앴다|없앴습니다)"
)
# ② 경위 덤프 — 날짜 박힌 사고·실측 서술
EVIDENCE = re.compile(r"(20\d\d-\d\d-\d\d|실측으로|사고 경위|장애 경위|밝혀졌)")

POINTER = "docs/implementation-plan.md"
# 추적용 출처 표기는 이력 서술이 아니다 — 마이그레이션 번호 `(0015)` 와
# 짧은 날짜 태그 `(2026-09-07)` 는 「현재 값의 이유」에 딸린 근거 표시로 본다.
SOURCE_TAG = re.compile(r"\(\d{4}\)|\([^()]{0,12}20\d\d-\d\d-\d\d[^()]{0,12}\)")

HINT = (
    "⚠️ 이력성 주석이 코드에 새로 들어갔습니다. 코드 주석은 **현재 동작과 그 이유 한두 줄**만 담습니다.\n"
    "   변경 서사(예전엔 X 였다·제거했다·되돌렸다)와 날짜 박힌 경위는\n"
    f"   `{POINTER}` 로 옮기고, 코드에는 결론 한 줄 + 포인터만 남기세요\n"
    f"   (예: `// 근거·경위: {POINTER}`).\n"
    "   마이그레이션 번호 태그(`(0015)`)처럼 추적용 출처 표기는 그대로 둬도 됩니다."
)


def added_lines(path: Path, root: Path) -> list[str]:
    """working tree 기준으로 이번에 추가된 줄. git 밖(미추적) 파일이면 전체를 본다."""
    result = subprocess.run(
        ["git", "diff", "-U0", "HEAD", "--", str(path)],
        cwd=root, capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        return []
    diff = result.stdout
    if not diff.strip():
        # 미추적 파일(git 이 diff 를 못 냄) — 새 파일이므로 전체를 검사한다.
        tracked = subprocess.run(
            ["git", "ls-files", "--error-unmatch", str(path)],
            cwd=root, capture_output=True, text=True, check=False,
        )
        if tracked.returncode != 0:
            try:
                return path.read_text(encoding="utf-8").splitlines()
            except OSError:
                return []
        return []
    return [line[1:] for line in diff.splitlines() if line.startswith("+") and not line.startswith("+++")]


def offenders(lines: list[str]) -> list[str]:
    hits = []
    for line in lines:
        if COMMENT_HEAD.match(line):
            comment = line
        else:
            tail = COMMENT_TAIL.search(line)
            if not tail:
                continue
            comment = line[tail.start():]
        if POINTER in comment:
            continue  # 이력으로 넘긴 뒤 남긴 포인터 — 이게 정답 형태다.
        if SOURCE_TAG.search(comment):
            continue  # 추적용 출처 표기
        if NARRATIVE.search(comment) or EVIDENCE.search(comment):
            hits.append(line.strip())
    return hits


def main() -> int:
    root_result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=False
    )
    if root_result.returncode != 0:
        return 0
    root = Path(root_result.stdout.strip())

    report: list[str] = []
    for raw in sys.argv[1:]:
        path = Path(raw)
        if path.suffix not in CODE_SUFFIXES or SKIP_PARTS & set(path.parts):
            continue
        if not path.is_file():
            continue
        hits = offenders(added_lines(path, root))
        if not hits:
            continue
        try:
            shown = path.relative_to(root)
        except ValueError:
            shown = path
        report.append(f"· {shown}")
        report.extend(f"    {h[:110]}" for h in hits[:5])
        if len(hits) > 5:
            report.append(f"    … 외 {len(hits) - 5}줄")

    if report:
        print(HINT)
        print("\n".join(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
