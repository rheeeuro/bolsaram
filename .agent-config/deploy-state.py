#!/usr/bin/env python3
"""배포 입력의 파일 메타데이터만 비교한다. .env 내용은 읽거나 기록하지 않는다."""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path


def snapshot(root: Path) -> dict:
    roots = [root / "apps/web/src", root / "apps/web/public"]
    roots += list((root / "packages").glob("*/src"))
    roots += [root / "db/migrations"]
    files = [root / name for name in (
        ".env", ".env.local", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
        "ecosystem.config.cjs", "apps/web/package.json", "apps/web/next.config.ts",
        "apps/web/tsconfig.json", "apps/web/postcss.config.mjs", "scripts/health-watch.ts",
    )]
    files += list((root / "packages").glob("*/package.json"))
    files += list((root / "packages/config").glob("*.json"))
    files += list((root / "packages/config").glob("*.mjs"))
    for directory in roots:
        for parent, directories, names in os.walk(directory):
            directories[:] = [name for name in directories if name not in {
                "node_modules", ".next", ".git", "__pycache__",
            } and not (Path(parent) / name).is_symlink()]
            files.extend(Path(parent) / name for name in names if not name.endswith(".tsbuildinfo"))
    result = {}
    for path in files:
        try:
            info = path.stat()
        except FileNotFoundError:
            continue
        if path.is_file():
            result[str(path.relative_to(root))] = [info.st_mtime_ns, info.st_ctime_ns, info.st_size]
    return result


def write_snapshot(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as handle:
        json.dump(value, handle, sort_keys=True)
        temporary = handle.name
    os.replace(temporary, path)


def main() -> None:
    action, root_arg, state_arg, *rest = sys.argv[1:]
    root, state = Path(root_arg), Path(state_arg)
    if action == "init":
        if not state.exists():
            write_snapshot(state, snapshot(root))
    elif action == "diff":
        before = json.loads(state.read_text()) if state.exists() else {}
        current = snapshot(root)
        write_snapshot(Path(rest[0]), current)
        for name in sorted(before.keys() | current.keys()):
            if before.get(name) != current.get(name):
                print(root / name)
    else:
        raise ValueError("지원하지 않는 배포 상태 명령")


if __name__ == "__main__":
    main()
