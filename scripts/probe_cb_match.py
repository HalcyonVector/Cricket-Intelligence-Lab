#!/usr/bin/env python3
"""Capture all four Cricbuzz match pages (facts / commentary / scorecard / squads)
for one match, so the tabbed live-match view can be built. All are Next.js pages
with data inlined in self.__next_f chunks.

SETUP:  pip install requests
RUN  :  python scripts/probe_cb_match.py --id 150679 --slug tsk-vs-miny-7th-match-major-league-cricket-2026
        python scripts/probe_cb_match.py        # auto-pick a recent match

Saves scripts/_cb_facts.html, _cb_commentary.html, _cb_score.html, _cb_squads.html.
"""
from __future__ import annotations
import argparse, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
           "Accept-Language": "en-US,en;q=0.9"}
ROUTES = {
    "facts":      "https://www.cricbuzz.com/cricket-match-facts/{id}/{slug}",
    "commentary": "https://www.cricbuzz.com/live-cricket-scores/{id}/{slug}",
    "score":      "https://www.cricbuzz.com/live-cricket-scorecard/{id}/{slug}",
    "squads":     "https://www.cricbuzz.com/cricket-match-squads/{id}/{slug}",
}
KEYS = {
    "facts": ('"umpire1"','"referee"','"playersOfTheMatch"','"tossResults"','"venue"','"matchType"','"seriesName"','"status"','"weather"'),
    "commentary": ('"commentaryList"','"commText"','"overSeparator"','"event"','"ballNbr"','"overNumber"','"timestamp"','"batTeamScore"'),
    "score": ('"scoreCard"','"batsmenData"','"bowlersData"','"scoreDetails"','"wicketsData"'),
    "squads": ('"playing XI"','"fullName"','"captain"','"keeper"','"role"'),
}


def get(url):
    import requests
    r = requests.get(url, headers=HEADERS, timeout=30)
    return r.status_code, r.text


def keymap(name, html):
    print(f"\n{'='*64}\n{name}  (len={len(html)})\n{'='*64}")
    for kw in KEYS.get(name, ()):
        print(f"   {kw:>22}: {html.count(kw)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", default=None)
    ap.add_argument("--slug", default="x")
    a = ap.parse_args()
    try:
        import requests  # noqa
    except ImportError:
        sys.exit("pip install requests")
    mid, slug = a.id, a.slug
    if not mid:
        try:
            _, h = get("https://www.cricbuzz.com/cricket-match/live-scores/recent-matches")
            mm = re.search(r"/live-cricket-scores/(\d+)/([a-z0-9-]+)", h)
            if mm:
                mid, slug = mm.group(1), mm.group(2)
                print(f"auto-picked match {mid} ({slug})")
        except Exception:
            pass
        if not mid:
            sys.exit("Pass --id and --slug (find them in a Cricbuzz match URL).")
    for name, tpl in ROUTES.items():
        url = tpl.format(id=mid, slug=slug)
        try:
            st, html = get(url)
            open(os.path.join(HERE, f"_cb_{name}.html"), "w", encoding="utf-8").write(html)
            print(f"\n### {name}: HTTP {st} -> saved scripts/_cb_{name}.html")
            if st == 200:
                keymap(name, html)
        except Exception as e:
            print(f"### {name}: FAILED {e!r}")
    print("\nDone. The four _cb_*.html files are in scripts/ — I'll build the tabbed match view.")


if __name__ == "__main__":
    main()
