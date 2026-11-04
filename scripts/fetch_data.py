#!/usr/bin/env python3
"""Download the latest built data into web/dashboard/ (stdlib only, ~25 MB).

The weekly GitHub Action publishes every generated file (cohort bundles, matchups,
extras, careers, rankings, players index) as one release asset instead of committing
it to git. Run this once after cloning, or as Render's build step:

    python scripts/fetch_data.py
"""
from __future__ import annotations
import io, os, sys, tarfile, urllib.request

REPO = os.environ.get("CIL_REPO", "HalcyonVector/Cricket-Intelligence-Lab")
URL = f"https://github.com/{REPO}/releases/download/data-latest/site-data.tar.gz"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, "web", "dashboard")
ALLOWED = ("index.js", "rankings.js", "players.js", "cohorts/", "careers/")


def main():
    print(f"Downloading {URL} ...")
    req = urllib.request.Request(URL, headers={"User-Agent": "cil-fetch-data"})
    with urllib.request.urlopen(req, timeout=120) as r:
        blob = r.read()
    print(f"  {len(blob) / 1e6:.1f} MB")
    n = 0
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as t:
        for m in t.getmembers():
            name = m.name.lstrip("./")
            # only regular files under the expected paths; never absolute or parent paths
            if not m.isfile() or ".." in name.split("/") or not name.startswith(ALLOWED):
                continue
            out = os.path.join(DEST, *name.split("/"))
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with t.extractfile(m) as src, open(out, "wb") as dst:
                dst.write(src.read())
            n += 1
    print(f"Extracted {n} files into {os.path.relpath(DEST, ROOT)}")
    if n == 0:
        sys.exit("Nothing extracted - is the data-latest release published?")


if __name__ == "__main__":
    main()
