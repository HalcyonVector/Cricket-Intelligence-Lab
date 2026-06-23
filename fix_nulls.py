#!/usr/bin/env python3
"""Strip stray trailing NUL bytes from text/source files in the repo.

Some files were written through a mount that can pad shortened files with NULs.
This removes trailing NULs (safe — they are never part of valid source) from
common text files so Python/Node can parse them.
"""
import os

EXTS = (".py", ".js", ".ts", ".tsx", ".json", ".html", ".css", ".md", ".sql", ".yml", ".yaml", ".toml")
ROOT = os.path.dirname(os.path.abspath(__file__))
fixed = 0
for dirpath, _, files in os.walk(ROOT):
    if "node_modules" in dirpath or "__pycache__" in dirpath or "/.git" in dirpath:
        continue
    for fn in files:
        if not fn.endswith(EXTS):
            continue
        p = os.path.join(dirpath, fn)
        try:
            data = open(p, "rb").read()
        except Exception:
            continue
        if b"\x00" in data:
            cleaned = data.rstrip(b"\x00")
            # also drop any interior NULs defensively
            cleaned = cleaned.replace(b"\x00", b"")
            open(p, "wb").write(cleaned)
            fixed += 1
            print("fixed", os.path.relpath(p, ROOT))
print(f"done. {fixed} file(s) cleaned.")
