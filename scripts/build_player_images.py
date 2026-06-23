#!/usr/bin/env python3
"""Build a name -> Cricbuzz headshot map by crawling Cricbuzz team pages ONCE.

Cricbuzz lists players as Next.js objects carrying imageDetails={imageId, alt}.
The headshot URL is:
    https://static.cricbuzz.com/a/img/v1/152x152/i1/c<imageId>/<alt>.jpg
We crawl every team, collect (name, imageId, alt), and write
web/dashboard/playerimg.js so the dashboard shows real photos offline.

SETUP: pip install requests
RUN  : python scripts/build_player_images.py
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
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                instr = not instr
            elif not instr:
                if c == "(":
                    depth += 1
                elif c == ")":
                    if depth == 0:
                        break
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


def all_objects(s):
    stack, in_str, esc = [], False, False
    for i, c in enumerate(s):
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == "{":
                stack.append(i)
            elif c == "}" and stack:
                yield s[stack.pop():i + 1]


def players_from_html(html):
    """Yield (name, imageId, alt) for every player object with imageDetails."""
    s = decode_next_stream(html)
    out = []
    for o in all_objects(s):
        if '"imageDetails"' not in o:
            continue
        if '"fullName"' not in o and '"profileUrl"' not in o:
            continue
        try:
            d = json.loads(o)
        except Exception:
            continue
        nm = d.get("fullName") or d.get("name")
        img = d.get("imageDetails") or {}
        iid, alt = img.get("imageId"), img.get("alt")
        itype = img.get("imageType") or "gthumb"
        if nm and iid:
            slug = alt or re.sub(r"[^a-z0-9]+", "-", nm.lower()).strip("-")
            out.append((nm, iid, slug, itype))
    return out


def img_url(iid, alt, itype="gthumb"):
    return f"https://static.cricbuzz.com/a/img/v1/i1/c{iid}/{alt}.jpg?d=high&p={itype}"


def keys_for(name):
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
    seen_t = {}
    for idx in ("", "/domestic", "/league", "/women"):
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
    if not teams:
        sys.exit("No teams parsed.")

    collected = {}  # name -> (imageId, alt, imageType)
    for n, (tid, tslug) in enumerate(teams, 1):
        got = 0
        for suffix in ("/players", ""):
            url = f"https://www.cricbuzz.com/cricket-team/{tslug}/{tid}{suffix}"
            try:
                sc, h = get(url)
            except Exception:
                continue
            for nm, iid, slug, itype in players_from_html(h):
                if nm not in collected:
                    collected[nm] = (iid, slug, itype)
                    got += 1
            if got:
                break
        if n == 1 and not collected:
            open(os.path.join(HERE, "_cb_team_debug.html"), "w", encoding="utf-8").write(h)
        print(f"  [{n}/{len(teams)}] {tslug}: total players {len(collected)}")
        time.sleep(0.25)

    if not collected:
        sys.exit("No players found; saved scripts/_cb_team_debug.html — send it to me.")

    full, surn = {}, {}
    for name, (iid, slug, itype) in collected.items():
        url = img_url(iid, slug, itype)
        ks = keys_for(name)
        if ks:
            full.setdefault(ks[0], url)
        if len(ks) > 1:
            surn.setdefault(ks[1], set()).add(iid)
    mp = dict(full)
    for name, (iid, slug, itype) in collected.items():
        ks = keys_for(name)
        if len(ks) > 1 and len(surn.get(ks[1], ())) == 1:
            mp.setdefault(ks[1], img_url(iid, slug, itype))
    dropped = sum(1 for k, v in surn.items() if len(v) > 1)
    print(f"  dropped {dropped} ambiguous surname+initial keys")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.CIL_PLAYERIMG=" + json.dumps(mp, separators=(",", ":")) + ";")
    print(f"\nWrote {OUT}: {len(collected):,} players, {len(mp):,} lookup keys.")
    print("Reload the dashboard — player profiles now show Cricbuzz headshots.")


if __name__ == "__main__":
    main()
