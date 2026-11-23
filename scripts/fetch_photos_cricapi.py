#!/usr/bin/env python3
"""Fill missing player photos from CricketData.org (CricAPI), most-played players first.

Cricbuzz headshots (playerimg.js) and Wikimedia photos (build_photo_wikidata.py) cover most players.
For the rest, this searches CricketData.org by each player's full name and uses its headshot
(https://h.cricapi.com/img/players/<id>.jpg). The free plan allows 100 API calls a day, and each
player costs one search, so run it once a day until the list is done; it remembers what it has
already tried in scripts/cricapi_lookups.json and never repeats a lookup.

A result is only accepted when the surname matches and the first-name initial agrees, and only
when exactly one CricketData player passes that check. Images every unmatched player shares (a
"no photo" placeholder) are rejected.

    1. Get a free API key at https://cricketdata.org and put it in .env (git-ignored):
           CRICAPI_KEY=your-key
    2. python scripts/fetch_photos_cricapi.py            # up to 95 searches
       python scripts/fetch_photos_cricapi.py --max 20   # fewer
"""
from __future__ import annotations
import argparse, collections, json, os, re, sys, time, unicodedata, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DASH = os.path.join(ROOT, "web", "dashboard")
META, IMG, PLAYERS = (os.path.join(DASH, f) for f in ("playermeta.js", "playerimg.js", "players.js"))
CACHE = os.path.join(ROOT, "scripts", "cricapi_lookups.json")
API = "https://api.cricapi.com/v1/players"
UA = "CricketIntelligenceLab/1.0 (https://github.com/HalcyonVector/Cricket-Intelligence-Lab)"
QUERY_NAMES = """SELECT ?ci ?name WHERE { ?p wdt:P2697 ?ci ; rdfs:label ?name . FILTER(LANG(?name) = "en") }"""


def load_js(path, var=None):
    t = open(path, encoding="utf-8").read()
    if var:
        m = re.search(r"window\." + re.escape(var) + r"\s*=\s*", t)
        return json.JSONDecoder().raw_decode(t, m.end())[0] if m else {}
    return json.JSONDecoder().raw_decode(t, t.index("{"))[0]


def api_key():
    k = os.environ.get("CRICAPI_KEY")
    p = os.path.join(ROOT, ".env")
    if not k and os.path.exists(p):
        m = re.search(r"^\s*CRICAPI_KEY\s*=\s*(\S+)", open(p, encoding="utf-8").read(), re.M)
        k = m.group(1).strip().strip("'\"") if m else None
    if not k:
        sys.exit("No CRICAPI_KEY in the environment or .env")
    return k


def tokens(n):
    n = unicodedata.normalize("NFKD", n or "").encode("ascii", "ignore").decode().lower()
    return [t for t in re.sub(r"[^a-z ]", " ", n).split() if t]


def same_person(ours, theirs):
    a, b = tokens(ours), tokens(theirs)
    return bool(a and b) and a[-1] == b[-1] and a[0][0] == b[0][0]


def main():
    import requests
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=95, help="searches to spend this run (free plan: 100 a day)")
    ap.add_argument("--top", type=int, default=400, help="only consider this many most-played players")
    a = ap.parse_args()
    key = api_key()

    meta = load_js(META, "CIL_PLAYERMETA")
    byid = load_js(IMG, "CIL_PLAYERIMG_BYID")
    idx = load_js(PLAYERS)
    cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}

    # most-played first: runs plus 20 per wicket, across every competition
    score = {pid: sum(r[1] + 20 * r[2] for r in e[1]) for pid, e in idx["p"].items()}
    missing = [pid for pid in sorted(score, key=lambda p: -score[p])
               if pid not in byid and not meta.get(pid, {}).get("photo")][:a.top]
    todo = [pid for pid in missing if pid not in cache]
    print(f"{len(missing)} of the top players have no photo; {len(todo)} not tried yet")
    if not todo:
        return

    # full names from Wikidata (Cricsheet often has initials only)
    r = requests.get("https://query.wikidata.org/sparql", params={"query": QUERY_NAMES}, timeout=180,
                     headers={"User-Agent": UA, "Accept": "application/sparql-results+json"})
    r.raise_for_status()
    full = {}
    for b in r.json()["results"]["bindings"]:
        full.setdefault(b["ci"]["value"].strip(), b["name"]["value"])

    used = 0
    for pid in todo:
        if used >= a.max:
            break
        m = meta.get(pid, {})
        ours = full.get(str(m.get("cricinfo_id") or "")) or m.get("name") or idx["p"][pid][0]
        resp = requests.get(API, params={"apikey": key, "offset": 0, "search": ours}, timeout=30, headers={"User-Agent": UA})
        used += 1
        d = resp.json()
        if d.get("status") != "success":
            print(f"API stopped: {d.get('reason') or d.get('status')}"); break
        hits = [p for p in d.get("data", []) if same_person(ours, p.get("name"))]
        cache[pid] = {"q": ours, "id": hits[0]["id"] if len(hits) == 1 else None, "n": len(hits)}
        print(f"  {ours:32s} -> {hits[0]['name'] if len(hits) == 1 else ('ambiguous' if hits else 'not found')}")
        time.sleep(1.2)
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), indent=1, sort_keys=True)
    print(f"used {used} searches this run (limit {d.get('info', {}).get('hitsLimit', 100)} a day, {d.get('info', {}).get('hitsToday', '?')} used today)")

    # check every matched headshot exists and is not a shared placeholder
    found = {pid: v["id"] for pid, v in cache.items() if v.get("id")}
    tags = {}
    for pid, cid in found.items():
        u = f"https://h.cricapi.com/img/players/{cid}.jpg"
        try:
            h = requests.head(u, timeout=20, headers={"User-Agent": UA})
            ok = h.status_code == 200 and h.headers.get("content-type", "").startswith("image")
            tags[pid] = (u, h.headers.get("etag") or h.headers.get("content-length")) if ok else None
        except Exception:
            tags[pid] = None
    shared = {t for t, n in collections.Counter(v[1] for v in tags.values() if v).items() if n >= 3}
    added = 0
    for pid, v in tags.items():
        if v and v[1] not in shared and pid in meta and not meta[pid].get("photo"):
            meta[pid]["photo"], meta[pid]["photo_src"] = v[0], "cricapi"
            added += 1
    with open(META, "w", encoding="utf-8") as fh:
        fh.write("window.CIL_PLAYERMETA=" + json.dumps(meta, separators=(",", ":"), ensure_ascii=False) + ";\n")
    print(f"added {added} CricketData.org photos -> {os.path.relpath(META, ROOT)}")


if __name__ == "__main__":
    main()
