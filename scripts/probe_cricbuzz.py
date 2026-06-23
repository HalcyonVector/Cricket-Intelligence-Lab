#!/usr/bin/env python3
"""Probe Cricbuzz so we can lock serve.py's parsers to the CURRENT markup.

Cricbuzz is now a Next.js app: the live/schedule pages inline the full match list
as JSON inside self.__next_f.push([...]) chunks, so plain `requests` + JSON
extraction gives clean structured data (serve.py uses exactly this). This script
saves the raw HTML of the live, schedule, and (optionally) a player profile page
into scripts/ so the parsers can be authored/verified against real data.

SETUP:
    pip install requests beautifulsoup4 lxml

RUN (from project root):
    python scripts/probe_cricbuzz.py
    # player profile (googlesearch is often blocked, so just paste a URL you opened):
    python scripts/probe_cricbuzz.py --profile-url https://www.cricbuzz.com/profiles/1413/virat-kohli

Writes scripts/_cb_live.html, _cb_schedule.html (and _cb_player.html). They land in
your repo folder; I read them and finalise serve.py.
"""
from __future__ import annotations
import argparse, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}
LIVE = "https://www.cricbuzz.com/cricket-match/live-scores"
SCHEDULE = "https://www.cricbuzz.com/cricket-schedule/upcoming-series/international"


def fetch(url):
    import requests
    r = requests.get(url, headers=HEADERS, timeout=30)
    return r.status_code, r.text


def summarise(name, html):
    print(f"\n{'='*70}\n{name}  (len={len(html)})\n{'='*70}")
    npush = html.count("self.__next_f.push(")
    nmatch = html.count('{"matchInfo":')
    print(f"   next_f chunks: {npush}   matchInfo objects: {nmatch}")
    print("   (serve.py extracts these JSON objects -> live/schedule/results)")


def summarise_player(html):
    print(f"\n{'='*70}\nplayer profile  (len={len(html)})\n{'='*70}")
    for kw in ('"faceImageId"', '"name"', '"intlTeam"', '"role"', '"bat"', '"bowl"',
               '"rankings"', '"battingStats"', '"bowlStats"', 'self.__next_f.push('):
        print(f"   {kw:>22}: {html.count(kw)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--player", default=None, help="player name (tries googlesearch)")
    ap.add_argument("--profile-url", default=None,
                    help="a Cricbuzz profile URL you opened in your browser")
    ap.add_argument("--search", default=None, help="a player name to probe Cricbuzz search (for photo/profile resolution)")
    a = ap.parse_args()
    try:
        import requests  # noqa
    except ImportError:
        sys.exit("Install deps:  pip install requests")

    for name, url in (("live", LIVE), ("schedule", SCHEDULE)):
        try:
            st, html = fetch(url)
            print(f"\n### {name}: HTTP {st}  {url}")
            open(os.path.join(HERE, f"_cb_{name}.html"), "w", encoding="utf-8").write(html)
            print(f"    saved scripts/_cb_{name}.html")
            if st == 200:
                summarise(name, html)
        except Exception as e:
            print(f"### {name}: FAILED {e!r}")

    link = a.profile_url
    if not link and a.player:
        try:
            from googlesearch import search
            for r in search(f"{a.player} cricbuzz profile", num_results=5):
                if "cricbuzz.com/profiles/" in r:
                    link = r
                    break
        except Exception as e:
            print(f"\n### player: googlesearch failed ({e!r}); pass --profile-url instead")
    if link:
        try:
            print(f"\n### player: {link}")
            st, html = fetch(link)
            open(os.path.join(HERE, "_cb_player.html"), "w", encoding="utf-8").write(html)
            print(f"    HTTP {st}; saved scripts/_cb_player.html")
            if st == 200:
                summarise_player(html)
        except Exception as e:
            print(f"\n### player: FAILED {e!r}")

    if a.search:
        # Cricbuzz has no public search page; resolve name -> profile via DuckDuckGo HTML
        # (this is exactly what serve.py's resolve_profile does).
        import re as _re, urllib.parse as _up
        q = _up.quote(f"{a.search} cricbuzz profile")
        for url in (f"https://html.duckduckgo.com/html/?q={q}",
                    f"https://lite.duckduckgo.com/lite/?q={q}"):
            try:
                print(f"\n### resolve: {url}")
                st, html = fetch(url)
                open(os.path.join(HERE, "_cb_ddg.html"), "w", encoding="utf-8").write(html)
                dec = _up.unquote(html)
                links = sorted(set(_re.findall(r"cricbuzz\.com/profiles/(\d+)/([a-z0-9-]+)", dec)))
                print(f"    HTTP {st}; cricbuzz profile links found: {len(links)}")
                for cid, slug in links[:8]:
                    print(f"      https://www.cricbuzz.com/profiles/{cid}/{slug}")
                if links:
                    break
            except Exception as e:
                print(f"### resolve: FAILED {e!r}")

    print("\nDone. The _cb_*.html files are in your scripts/ folder - I'll read them "
          "and finalise serve.py.")


if __name__ == "__main__":
    main()
