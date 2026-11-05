#!/usr/bin/env python3
"""Add Wikimedia Commons photos to web/dashboard/playermeta.js, matched by ESPNcricinfo ID.

Cricsheet's people register gives every player an ESPNcricinfo ID (stored as cricinfo_id in
playermeta.js by enrich_players_cricinfo.py). Wikidata links those IDs (property P2697) to a
photo on Wikimedia Commons (P18). This fills profile photos for players the Cricbuzz photo map
(playerimg.js) doesn't cover - no live search at page load, no scraping.

Photos keep their Commons licence; the dashboard links each one back to its Commons page.

    pip install requests
    python scripts/build_photo_wikidata.py
"""
from __future__ import annotations
import json, os, re, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META = os.path.join(ROOT, "web", "dashboard", "playermeta.js")
IMG = os.path.join(ROOT, "web", "dashboard", "playerimg.js")
UA = "CricketIntelligenceLab/1.0 (https://github.com/HalcyonVector/Cricket-Intelligence-Lab)"
QUERY = "SELECT ?ci ?img WHERE { ?p wdt:P2697 ?ci ; wdt:P18 ?img . }"


def load_js_object(path, var):
    t = open(path, encoding="utf-8").read()
    m = re.search(r"window\." + re.escape(var) + r"\s*=\s*", t)
    obj, _ = json.JSONDecoder().raw_decode(t, m.end())
    return obj


def main():
    import requests
    r = requests.get("https://query.wikidata.org/sparql", params={"query": QUERY},
                     headers={"User-Agent": UA, "Accept": "application/sparql-results+json"}, timeout=120)
    r.raise_for_status()
    photos = {}
    for b in r.json()["results"]["bindings"]:
        ci = b["ci"]["value"].strip()
        f = urllib.parse.unquote(b["img"]["value"].rsplit("/", 1)[-1])  # ...Special:FilePath/<File name>
        photos.setdefault(ci, f)
    print(f"Wikidata: {len(photos):,} cricketers with a Commons photo")

    meta = load_js_object(META, "CIL_PLAYERMETA")
    try:
        byid = load_js_object(IMG, "CIL_PLAYERIMG_BYID")
    except Exception:
        byid = {}
    added = 0
    for pid, m in meta.items():
        m.pop("photo", None); m.pop("photo_page", None)
        f = photos.get(str(m.get("cricinfo_id") or ""))
        if not f or pid in byid:  # Cricbuzz headshots stay first choice where we have them
            continue
        q = urllib.parse.quote(f.replace(" ", "_"))
        m["photo"] = f"https://commons.wikimedia.org/wiki/Special:FilePath/{q}?width=240"
        m["photo_page"] = f"https://commons.wikimedia.org/wiki/File:{q}"
        added += 1
    with open(META, "w", encoding="utf-8") as fh:
        fh.write("window.CIL_PLAYERMETA=" + json.dumps(meta, separators=(",", ":"), ensure_ascii=False) + ";\n")
    print(f"Added Commons photos for {added:,} players without a Cricbuzz headshot -> {os.path.relpath(META, ROOT)}")


if __name__ == "__main__":
    main()
