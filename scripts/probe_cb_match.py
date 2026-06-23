#!/usr/bin/env python3
"""Capture a Cricbuzz match's SCORECARD + SQUADS pages so the full-scorecard /
playing-XI parser can be authored into serve.py.

The live/recent match list only has mini scores. The full innings tables, batting/
bowling cards, and playing XI live on separate Cricbuzz pages:
    scorecard : https://www.cricbuzz.com/cricket-scorecard/<id>/<slug>
    squads    : https://www.cricbuzz.com/cricket-match-squads/<id>/<slug>
These are Next.js pages (data inlined in self.__next_f chunks), same as everything
else. This script discovers a match id from the live page, downloads those pages,
saves them into scripts/, and prints a quick map of the embedded JSON.

SETUP:  pip install requests
RUN  :  python scripts/probe_cb_match.py
        python scripts/probe_cb_match.py --id 12345 --slug ind-vs-aus   # a specific match

Send the saved scripts/_cb_score.html and _cb_squads.html back (they land in your
repo folder; I read them and build the scorecard view).
"""
from __future__ import annotations
import argparse, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
           "Accept-Language": "en-US,en;q=0.9"}
LIVE = "https://www.cricbuzz.com/cricket-match/live-scores"


def get(url):
    import requests
    r = requests.get(url, headers=HEADERS, timeout=30)
    return r.status_code, r.text


def keymap(html, label):
    print(f"\n{'='*64}\n{label}  (len={len(html)})\n{'='*64}")
    for kw in ('"scoreCard"', '"batsman"', '"bowler"', '"inningsId"', '"batTeamDetails"',
               '"bowlTeamDetails"', '"playersDetails"', '"playerId"', '"playingXi"',
               '"captain"', '"keeper"', '"wicketCode"', '"runs"', '"fallOfWickets"',
               '"partnership"', 'self.__next_f.push('):
        n = html.count(kw)
        if n:
            print(f"   {kw:>22}: {n}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", default=None)
    ap.add_argument("--slug", default="x")
    a = ap.parse_args()
    try:
        import requests  # noqa
    except ImportError:
        sys.exit("pip install requests")

    cand = []
    if a.id:
        cand = [(a.id, a.slug)]
    else:
        # completed matches (recent) are guaranteed to have a full scorecard
        for src in ("https://www.cricbuzz.com/cricket-match/live-scores/recent-matches",
                    LIVE):
            try:
                st, html = get(src)
            except Exception:
                continue
            for i, sl in re.findall(r"/(?:live-cricket-scores|cricket-scores)/(\d+)/([a-z0-9-]+)", html):
                if i not in [x[0] for x in cand]:
                    cand.append((i, sl))
            if cand:
                print(f"{src.rsplit('/',1)[-1]}: found {len(cand)} matches")
                break
        if not cand:
            sys.exit("No match links found.")

    # the scorecard route was renamed on the rebuilt site; try several patterns per match
    def score_urls(mid, slug):
        return [f"https://www.cricbuzz.com/live-cricket-scorecard/{mid}/{slug}",
                f"https://www.cricbuzz.com/live-cricket-scores/{mid}/{slug}"]
    def has_card(h):
        return any(k in h for k in ('"batsman"','"batTeamDetails"','"scoreCard"','"bowlTeamDetails"','"batsmenData"','"bowlersData"','"inningsId"'))
    chosen = None
    saved_base = False
    for mid, slug in cand[:15]:
        for url in score_urls(mid, slug):
            try:
                st, html = get(url)
            except Exception:
                continue
            ok = st == 200 and has_card(html)
            print(f"  {('OK  ' if ok else 'no  ')}HTTP {st}  {url.split('cricbuzz.com')[1]}")
            if st == 200 and not saved_base:
                open(os.path.join(HERE, "_cb_score.html"), "w", encoding="utf-8").write(html)
                saved_base = True
                print(f"    (saved base for inspection -> _cb_score.html)")
                keymap(html, "base page (for inspection)")
            if ok:
                open(os.path.join(HERE, "_cb_score.html"), "w", encoding="utf-8").write(html)
                print(f"### score: FULL CARD saved scripts/_cb_score.html  ({url})")
                keymap(html, "score")
                chosen = (mid, slug)
                break
        if chosen:
            break
    if not chosen:
        chosen = cand[0]
        print("No full-card route matched; base match page saved for inspection.")
    mid, slug = chosen
    try:
        st, html = get(f"https://www.cricbuzz.com/cricket-match-squads/{mid}/{slug}")
        open(os.path.join(HERE, "_cb_squads.html"), "w", encoding="utf-8").write(html)
        print(f"\n### squads: HTTP {st} -> saved scripts/_cb_squads.html")
        if st == 200:
            keymap(html, "squads")
    except Exception as e:
        print(f"### squads: FAILED {e!r}")

    print("\nDone. Send me scripts/_cb_score.html and _cb_squads.html (or just say it's done) "
          "and I'll build the full scorecard + playing XI into the live match view.")


if __name__ == "__main__":
    main()
