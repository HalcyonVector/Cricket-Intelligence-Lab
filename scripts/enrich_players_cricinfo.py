#!/usr/bin/env python3
"""Map every Cricsheet player in the dashboard to their ESPNcricinfo id (and a
canonical name / unique name), using Cricsheet's OWN people register — which is
authoritative and already keyed on the exact 8-hex identifiers the dashboard uses.

It writes  web/dashboard/playermeta.js  which the dashboard loads automatically to
show an "ESPNcricinfo ↗" link (and country badge) on each player's profile.

USAGE (from the project root):
    pip install requests
    python scripts/enrich_players_cricinfo.py

No API key needed. Re-run whenever you rebuild cohorts.
"""
from __future__ import annotations
import csv, io, json, os, re, sys, glob, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COHORT_DIR = os.path.join(ROOT, "web", "dashboard", "cohorts")
OUT = os.path.join(ROOT, "web", "dashboard", "playermeta.js")
REGISTER_URL = "https://cricsheet.org/register/people.csv"


def collect_player_ids() -> set[str]:
    """Pull every player id (batters + bowlers) out of the cohort .js bundles."""
    ids = set()
    for f in glob.glob(os.path.join(COHORT_DIR, "*.js")):
        txt = open(f, encoding="utf-8").read()
        m = re.match(r"window\.__cohortLoaded\([^,]+,(.*)\);\s*$", txt, re.S)
        if not m:
            continue
        data = json.loads(m.group(1))
        ids.update(data.get("players", {}).keys())
        ids.update(data.get("bowlers", {}).keys())
    return ids


def fetch_register() -> list[dict]:
    print(f"Downloading {REGISTER_URL} ...")
    req = urllib.request.Request(REGISTER_URL, headers={"User-Agent": "Mozilla/5.0 (CIL enrich)"})
    raw = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
    return list(csv.DictReader(io.StringIO(raw)))


def main():
    ids = collect_player_ids()
    if not ids:
        sys.exit("No cohort bundles found under web/dashboard/cohorts/. Run build_all.py first.")
    print(f"{len(ids):,} unique player ids in the dashboard.")
    rows = fetch_register()
    if not rows:
        sys.exit("Empty register.")
    cols = rows[0].keys()
    id_col = next((c for c in cols if c.lower() in ("identifier", "id")), None)
    name_col = next((c for c in cols if c.lower() == "name"), None)
    uniq_col = next((c for c in cols if "unique" in c.lower()), None)
    ci_col = next((c for c in cols if "cricinfo" in c.lower()), None)
    print(f"register columns -> id:{id_col} name:{name_col} cricinfo:{ci_col}")
    if not id_col:
        sys.exit(f"Could not find an identifier column. Columns were: {list(cols)}")

    meta = {}
    for r in rows:
        pid = r.get(id_col)
        if pid not in ids:
            continue
        entry = {}
        if name_col and r.get(name_col):
            entry["name"] = r[name_col]
        if uniq_col and r.get(uniq_col):
            entry["unique_name"] = r[uniq_col]
        if ci_col and r.get(ci_col):
            entry["cricinfo_id"] = r[ci_col]
        if entry:
            meta[pid] = entry

    matched = sum(1 for v in meta.values() if v.get("cricinfo_id"))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.CIL_PLAYERMETA=" + json.dumps(meta, separators=(",", ":")) + ";")
    print(f"Wrote {OUT}")
    print(f"  {len(meta):,} players enriched · {matched:,} with an ESPNcricinfo id.")
    print("Reload the dashboard — player profiles now show an ESPNcricinfo link.")


if __name__ == "__main__":
    main()
