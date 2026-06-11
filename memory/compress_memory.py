#!/usr/bin/env python3
"""
Compress session memory into concise project memory notes.
"""

import json
import sys
from pathlib import Path


def compress_session_memory(session_file: Path, limit: int = 20) -> dict:
    if not session_file.exists():
        return {"summary": [], "error": "session file not found"}

    lines = [line.strip() for line in session_file.read_text(encoding="utf-8").splitlines() if line.strip()]
    clipped = lines[-limit:]
    return {
        "summary": clipped,
        "source_count": len(lines),
        "kept_count": len(clipped),
    }


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: python memory/compress_memory.py <session_memory.md> <project_memory.json>")
        return 1

    session_path = Path(sys.argv[1]).resolve()
    project_path = Path(sys.argv[2]).resolve()
    compressed = compress_session_memory(session_path)

    project_path.parent.mkdir(parents=True, exist_ok=True)
    project_path.write_text(json.dumps(compressed, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": "ok", "output": str(project_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
