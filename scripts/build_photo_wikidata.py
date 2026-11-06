#!/usr/bin/env python3
"""Add Wikimedia Commons photos to web/dashboard/playermeta.js, matched by ESPNcricinfo ID.

Two sources: the photo on the player's Wikidata item (P18), then the freely licensed lead
image of their English Wikipedia article when Wikidata has none.

Cricsheet's people register gives every player an ESPNcricinfo ID (stored as cricinfo_id in
playermeta.js by enrich_players_cricinfo.py). Wikidata links those IDs (property P2697) to a
photo on Wikimedia Commons (P18). This fills profile photos for players the Cricbuzz photo map
(playerimg.js) doesn't cover - no live search at page load, no scraping.

Photos keep their Commons licence; the dashboard links each one back to its Commons page.

    pip install requests
    python scripts/build_photo_wikidata.py
"""
from __future__ import annotations
import json, os, re, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META = os.path.join(ROOT, "web", "dashboard", "playermeta.js")
IMG = os.path.join(ROOT, "web", "dashboard", "playerimg.js")
UA = "CricketIntelligenceLab/1.0 (https://github.com/HalcyonVector/Cricket-Intelligence-Lab)"
QUERY = "SELECT ?ci ?img WHERE { ?p wdt:P2697 ?ci ; wdt:P18 ?img . }"
# second source: the English Wikipedia article's lead image, for players whose Wikidata item has
# no photo (P18). Wikipedia's API is asked for freely licensed images only (pilicense=free).
QUERY_ARTICLES = """SELECT ?ci ?article WHERE { ?p wdt:P2697 ?ci . FILTER NOT EXISTS { ?p wdt:P18 ?i }
  ?article schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> . }"""


def wiki_lead_images(requests, titles):
    """{title: (thumbnail url, file page)} for free lead images, 50 titles per API call."""
    out, titles = {}, list(titles)
    for i in range(0, len(titles), 50):
        batch = titles[i:i + 50]
        r = requests.get("https://en.wikipedia.org/w/api.php", headers={"User-Agent": UA}, timeout=60, params={
            "action": "query", "format": "json", "formatversion": 2, "redirects": 1, "prop": "pageimages",
            "piprop": "thumbnail|name", "pithumbsize": 240, "pilicense": "free", "titles": "|".join(batch)})
        r.raise_for_status(); q = r.json().get("query", {})
        back = {}
        for m in q.get("normalized", []) + q.get("redirects", []):
            back[m["to"]] = back.get(m["from"], m["from"])
        for pg in q.get("pages", []):
            th, name = pg.get("thumbnail", {}).get("source"), pg.get("pageimage")
            if th and name:
                out[back.get(pg["title"], pg["title"])] = (th, "https://commons.wikimedia.org/wiki/File:" + urllib.parse.quote(name))
        time.sleep(0.2)  # be gentle with the API
    return out


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
    # second pass: Wikipedia lead images for players still without any photo
    def sparql(q):
        rr = requests.get("https://query.wikidata.org/sparql", params={"query": q},
                          headers={"User-Agent": UA, "Accept": "application/sparql-results+json"}, timeout=180)
        rr.raise_for_status(); return rr.json()["results"]["bindings"]
    art = {}
    for bnd in sparql(QUERY_ARTICLES):
        art.setdefault(bnd["ci"]["value"].strip(), urllib.parse.unquote(bnd["article"]["value"].rsplit("/wiki/", 1)[-1]).replace("_", " "))
    need = {pid: art[str(m.get("cricinfo_id"))] for pid, m in meta.items()
            if not m.get("photo") and pid not in byid and str(m.get("cricinfo_id") or "") in art}
    print(f"Wikipedia: looking up lead images for {len(need):,} players")
    lead = wiki_lead_images(requests, set(need.values()))
    added_wp = 0
    for pid, title in need.items():
        if title in lead:
            meta[pid]["photo"], meta[pid]["photo_page"] = lead[title]
            added_wp += 1
    print(f"Added Wikipedia lead images (free licences only) for {added_wp:,} more players")
    with open(META, "w", encoding="utf-8") as fh:
        fh.write("window.CIL_PLAYERMETA=" + json.dumps(meta, separators=(",", ":"), ensure_ascii=False) + ";\n")
    print(f"Added Commons photos for {added:,} players without a Cricbuzz headshot -> {os.path.relpath(META, ROOT)}")


if __name__ == "__main__":
    main()
