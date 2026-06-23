#!/usr/bin/env python3
"""Build a name -> Cricbuzz headshot map.

Chain (team pages no longer inline images, only profile links):
  1. team /players page  -> /profiles/<id>/<slug> for every player (SSR links)
  2. each profile page   -> "faceImageId": <imgId>
  3. headshot URL        -> static.cricbuzz.com/a/img/v1/i1/c<imgId>/<slug>.jpg?d=high&p=gthumb

Writes web/dashboard/playerimg.js (loaded by the dashboard; works offline).

SETUP: pip install requests
RUN  : python scripts/build_player_images.py          # international teams (fast)
       python scripts/build_player_images.py --all     # + domestic/league/women (slow)
       python scripts/build_player_images.py --max 50   # cap players (for testing)
"""
from __future__ import annotations
import argparse, json, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "dashboard", "playerimg.js")
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
           "Accept-Language": "en-US,en;q=0.9"}
TEAMS_INDEX = "https://www.cricbuzz.com/cricket-team"


def get(url):
    import requests
    r = requests.get(url, headers=HEADERS, timeout=30)
    return r.status_code, r.text


def decode_next_stream(html):
    out, key, i = [], "self.__next_f.push(", 0
    while True:
        j = html.find(key, i)
        if j < 0:
            break
        k = j + len(key)
        depth, end, instr, esc = 0, k, False, False
        while end < len(html):
            c = html[end]
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == '"': instr = not instr
            elif not instr:
                if c == "(": depth += 1
                elif c == ")":
                    if depth == 0: break
                    depth -= 1
            end += 1
        try:
            a = json.loads(html[k:end])
            if isinstance(a, list) and len(a) > 1 and isinstance(a[1], str):
                out.append(a[1])
        except Exception:
            pass
        i = end + 1
    return "".join(out)


def profile_links(html):
    s = decode_next_stream(html)
    return sorted(set(re.findall(r"profiles/(\d+)/([a-z0-9][a-z0-9-]+)", s)))


def face_image_id(profile_html):
    s = decode_next_stream(profile_html)
    for m in re.findall(r'"faceImageId"\s*:\s*(\d+)', s):
        if m and m != "0":
            return m
    return None


def img_url(face_id, slug):
    return f"https://static.cricbuzz.com/a/img/v1/i1/c{face_id}/{slug}.jpg?d=high&p=gthumb"


def keys_for(name):
    t = re.sub(r"[^a-z ]", "", name.lower()).split()
    if not t:
        return []
    return ["".join(t), t[-1] + "|" + t[0][0]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="also crawl domestic/league/women teams")
    ap.add_argument("--max", type=int, default=0, help="cap number of players (testing)")
    a = ap.parse_args()
    try:
        import requests  # noqa
    except ImportError:
        sys.exit("pip install requests")

    indexes = [""] + (["/domestic", "/league", "/women"] if a.all else [])
    seen_t = {}
    for idx in indexes:
        try:
            st, html = get(TEAMS_INDEX + idx)
        except Exception:
            continue
        print(f"teams index{idx or ''}: HTTP {st}")
        for tslug, tid in re.findall(r"/cricket-team/([a-z][a-z0-9-]+)/(\d+)", html):
            if tslug in ("domestic", "league", "women", "matches", "news",
                         "players", "results", "schedule"):
                continue
            seen_t.setdefault(tid, tslug)
    teams = sorted((tid, tslug) for tid, tslug in seen_t.items())
    print(f"found {len(teams)} teams")

    # 1) collect unique players (profileId -> slug) from team /players pages
    players = {}
    for n, (tid, tslug) in enumerate(teams, 1):
        try:
            sc, h = get(f"https://www.cricbuzz.com/cricket-team/{tslug}/{tid}/players")
        except Exception:
            continue
        for pid, slug in profile_links(h):
            players.setdefault(pid, slug)
        if n % 20 == 0 or n == len(teams):
            print(f"  teams {n}/{len(teams)} -> {len(players)} players so far")
        time.sleep(0.15)
    if a.max:
        players = dict(list(players.items())[:a.max])
    print(f"resolving headshots for {len(players)} players...")

    # 2) each profile -> faceImageId
    collected = {}  # name -> url
    for n, (pid, slug) in enumerate(players.items(), 1):
        try:
            sc, h = get(f"https://www.cricbuzz.com/profiles/{pid}/{slug}")
            fid = face_image_id(h)
        except Exception:
            fid = None
        if fid:
            collected[slug.replace("-", " ")] = img_url(fid, slug)
        if n % 50 == 0 or n == len(players):
            print(f"  profiles {n}/{len(players)} -> {len(collected)} with photos")
        time.sleep(0.15)

    if not collected:
        sys.exit("No headshots resolved.")

    # 3) keys (+ drop ambiguous surname|initial shared by 2+ players)
    full, surn = {}, {}
    for name, url in collected.items():
        ks = keys_for(name)
        if ks:
            full.setdefault(ks[0], url)
        if len(ks) > 1:
            surn.setdefault(ks[1], set()).add(url)
    mp = dict(full)
    for name, url in collected.items():
        ks = keys_for(name)
        if len(ks) > 1 and len(surn.get(ks[1], ())) == 1:
            mp.setdefault(ks[1], url)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.CIL_PLAYERIMG=" + json.dumps(mp, separators=(",", ":")) + ";")
    print(f"\nWrote {OUT}: {len(collected):,} players, {len(mp):,} lookup keys.")
    print("Hard-refresh the dashboard — player photos now load.")


if __name__ == "__main__":
    main()
