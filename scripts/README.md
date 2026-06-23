# External-data scripts

These add the ~20% of data that is **not** in Cricsheet ball-by-ball (ICC rankings,
ESPNcricinfo profile links). You run them on your own machine; the dashboard picks
up the results automatically. If you never run them, the dashboard works fine — the
"ICC Rankings" tab and the profile links simply stay hidden.

Run both from the **project root** (the folder with `build_all.py`).

## 1. ESPNcricinfo links + countries  — reliable
```
pip install requests
python scripts/enrich_players_cricinfo.py
```
Uses Cricsheet's own people register (`cricsheet.org/register/people.csv`), which is
keyed on the exact player IDs the dashboard uses, so matching is exact — no fuzzy
name-matching. Writes `web/dashboard/playermeta.js`. After reloading, each player
profile shows a country badge and an **ESPNcricinfo ↗** link.

## 2. ICC rankings  — headless browser
icc-cricket.com is a JavaScript app: the ranking tables are not in the page HTML, so a
plain scrape gets nothing. This script renders each page in a headless browser, then
reads the table.

One-time setup:
```
pip install playwright
python -m playwright install chromium
```
Run:
```
python scripts/fetch_icc_rankings.py            # live
python scripts/fetch_icc_rankings.py --demo     # tiny sample, to preview the tab
python scripts/fetch_icc_rankings.py --debug    # also dump rendered HTML if a page parses empty
```
Covers men's & women's, Test/ODI/T20I, batting/bowling/all-rounder + team tables
(women's Test is skipped — it doesn't exist). Writes `web/dashboard/rankings.js`;
reloading adds an **ICC Rankings** tab. If any page parses empty, re-run with `--debug`
and send me one of the `scripts/_debug_*.html` files and I'll finalize the selector.

## Awards / honours
There is no clean public machine-readable feed for ICC awards (Player of the Year,
etc.). If you have or can export a CSV (`year, award, player`), drop it in and I'll
wire an "Awards" tab the same way.

## 3. Live scores, schedule & results  — local app server
This is the **server mode**: live data instead of a static snapshot.

Data source is **Cricbuzz**. It's a Next.js app that inlines the full match list as
JSON inside the page (`self.__next_f.push([...])` chunks), so `serve.py` just does a
plain `requests` GET and extracts that JSON — **no headless browser, no API key**.
(This replaced two dead ends: `python-espncricinfo` doesn't work here, and ESPN's JSON
API blocks headless navigation; the old Cricbuzz `cb-*` HTML-scrape is also gone since
Cricbuzz was rebuilt.)

One-time setup:
```
pip install requests
```

Run from the project root (note: `serve.py` lives at the root, not in `scripts/`):
```
python serve.py
```
Then open **http://127.0.0.1:5000**. Endpoints: `/api/live`, `/api/schedule`,
`/api/results`, `/api/_debug`. The plain static dashboard (double-clicking
`web/dashboard/index.html`) still works — these tabs just light up when the server runs.

### Probe (only if Cricbuzz changes its markup)
`scripts/probe_cricbuzz.py` saves the current live/schedule HTML into `scripts/` so the
parser can be re-verified:
```
pip install requests
python scripts/probe_cricbuzz.py
# player profile (for stats/photos): paste a URL you opened in your browser
python scripts/probe_cricbuzz.py --profile-url https://www.cricbuzz.com/profiles/1413/virat-kohli
```

The older `scripts/probe_cricinfo.py` and `scripts/probe_espn_api.py` target
ESPNcricinfo and are kept only for reference — Cricbuzz is the live source now.
