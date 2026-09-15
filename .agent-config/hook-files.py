#!/usr/bin/env python3
"""Claude file_path 및 Codex apply_patch 입력에서 변경 경로만 추출한다."""
import json
import re
import sys
from pathlib import Path


def paths(payload: dict, root: Path) -> list[str]:
    tool_input = payload.get("tool_input", {})
    if not isinstance(tool_input, dict):
        return []
    names = []
    if isinstance(tool_input.get("file_path"), str):
        names.append(tool_input["file_path"])
    if payload.get("tool_name") == "apply_patch":
        command = tool_input.get("command", "")
        if isinstance(command, str):
            names += re.findall(r"^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$", command, re.M)
    cwd = Path(payload.get("cwd") or root)
    result = []
    for name in names:
        path = Path(name)
        path = path if path.is_absolute() else cwd / path
        path = path.resolve()
        if path.is_relative_to(root.resolve()) and str(path) not in result:
            result.append(str(path))
    return result


if __name__ == "__main__":
    for path in paths(json.load(sys.stdin), Path(sys.argv[1])):
        print(path)
