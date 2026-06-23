#!/usr/bin/env python3
"""Build a name -> Cricbuzz headshot map by crawling Cricbuzz team pages ONCE.

Why: Cricbuzz has no public search and search engines are bot-walled in this env,
so we can't resolve a player's photo by name on the fly. But Cricbuzz team/squad
pages list players as /profiles/<id>/<slug> links, and a player's headshot is simply
    https://i.cricketcb.com/stats/img/faceImages/<id>.jpg
(keyed by the same profile id). So we crawl every team once, collect those links,
and write web/dashboard/playerimg.js which the dashboard loads to show real photos -
works even when opening the file directly (no server needed).

SETUP:
    pip install requests
RUN (from project root):
    python scripts/build_player_images.py
Re-run occasionally to pick up new players. Output: web/dashboard/playerimg.js
"""
from __future__ import annotations
import os, re, sys, time, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "dashboard", "playerimg.js")
HERE = os.path.dirname(os.path.abspath(__file__))
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
           "Accept-Language": "en-US,en;q=0.9"}
TEAMS_INDEX = "https://www.cricbuzz.com/cricket-team"
IMG = "https://i.cricketcb.com/stats/img/faceImages/{cid}.jpg"


def get(url):
    import requests
    r = requests.get(url, headers=HEADERS, timeout=30)
    return r.status_code, r.text


def keys_for(name):
    """Match keys: full compact name, plus 'surname|firstInitial' (handles Cricsheet 'V Kohli')."""
    t = re.sub(r"[^a-z ]", "", name.lower()).split()
    if not t:
        return []
    ks = ["".join(t)]
    ks.append(t[-1] + "|" + t[0][0])
    return ks


def main():
    try:
        import requests  # noqa
    except ImportError:
        sys.exit("pip install requests")
    # team URL pattern is /cricket-team/<slug>/<id>; crawl the int'l, domestic, league & women indexes
    seen_t = {}
    for idx in ("", "/domestic", "/league", "/women"):
        try:
            st, html = get(TEAMS_INDEX + idx)
        except Exception:
            continue
        print(f"teams index{idx or ''}: HTTP {st}")
        for tslug, tid in re.findall(r"/cricket-team/([a-z][a-z0-9-]+)/(\d+)", html):
            if tslug in ("domestic", "league", "women", "matches", "news", "players", "results", "schedule"):
                continue
            seen_t.setdefault(tid, tslug)
        if not seen_t and idx == "":
            open(os.path.join(HERE, "_cb_teams_debug.html"), "w", encoding="utf-8").write(html)
    teams = sorted((tid, tslug) for tid, tslug in seen_t.items())
    print(f"found {len(teams)} teams")
    if not teams:
        sys.exit("No teams parsed; saved scripts/_cb_teams_debug.html — send it to me.")

    players = {}  # cid -> slug
    for n, (tid, tslug) in enumerate(teams, 1):
        got = 0
        for suffix in ("/players", ""):
            url = f"https://www.cricbuzz.com/cricket-team/{tslug}/{tid}{suffix}"
            try:
                sc, h = get(url)
            except Exception:
                continue
            found = re.findall(r"/profiles/(\d+)/([a-z0-9-]+)", h)
            if not found and "self.__next_f.push(" in h:  # decode Next.js chunks
                import urllib.parse as _up
                dec = _up.unquote(h)
                found = re.findall(r"/profiles/(\d+)/([a-z0-9-]+)", dec)
            for cid, pslug in found:
                if cid not in players:
                    players[cid] = pslug
                    got += 1
            if got:
                break
        if n == 1 and not players:
            open(os.path.join(HERE, "_cb_team_debug.html"), "w", encoding="utf-8").write(h)
        print(f"  [{n}/{len(teams)}] {tslug}: total players {len(players)}")
        time.sleep(0.25)

    if not players:
        sys.exit("No players found; saved scripts/_cb_team_debug.html — send it to me.")

    # Build keys; for the ambiguous 'surname|initial' key, drop it if 2+ DIFFERENT players
    # share it (e.g. two 'S Sharma') so we never show the wrong face. Full-name keys are kept.
    full, surn = {}, {}
    for cid, pslug in players.items():
        name = pslug.replace("-", " ").strip()
        url = IMG.format(cid=cid)
        ks = keys_for(name)
        if ks:
            full.setdefault(ks[0], url)
        if len(ks) > 1:
            surn.setdefault(ks[1], set()).add(cid)
    mp = dict(full)
    amb = 0
    for cid, pslug in players.items():
        name = pslug.replace("-", " ").strip()
        ks = keys_for(name)
        if len(ks) > 1:
            if len(surn.get(ks[1], ())) == 1:
                mp.setdefault(ks[1], IMG.format(cid=cid))
            else:
                amb += 1
    print(f"  dropped {len(set(k for k,v in surn.items() if len(v)>1))} ambiguous surname+initial keys")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.CIL_PLAYERIMG=" + json.dumps(mp, separators=(",", ":")) + ";")
    print(f"\nWrote {OUT}: {len(players):,} players, {len(mp):,} lookup keys.")
    print("Reload the dashboard — player profiles now show Cricbuzz headshots.")


if __name__ == "__main__":
    main()
