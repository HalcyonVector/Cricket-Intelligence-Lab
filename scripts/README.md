# Scripts

Run everything from the **project root** (the folder with `serve.py`).

## Data
| Script | What it does |
|--------|--------------|
| `fetch_data.py` | Downloads the latest built data (the `data-latest` release, about 25 MB) into `web/dashboard/`. Run this after cloning. |
| `build_all.py` | Rebuilds everything from a Cricsheet zip: `python scripts/build_all.py --zip all_json.zip` (needs `pip install orjson numpy`). |
| `verify_build.py` | Integrity check that `build_all.py` runs at the end. For the full cross-check use `python tests/data_consistency.py`. |

## Extra data not in Cricsheet's ball-by-ball files
These are optional. Without them the dashboard still works; the ICC Rankings tab, country badges, ESPNcricinfo links and some photos just don't appear.

### ESPNcricinfo links and countries
```
pip install requests
python scripts/enrich_players_cricinfo.py
```
Uses Cricsheet's people register (`cricsheet.org/register/people.csv`), keyed on the same player IDs as the match data, so matching is exact. Writes `web/dashboard/playermeta.js`.

### Player photos
```
pip install requests
python scripts/build_photo_wikidata.py
```
Adds Wikimedia Commons photos (matched through Wikidata's ESPNcricinfo ID) to players without a Cricbuzz headshot, with a credit link on the profile. Run it after `enrich_players_cricinfo.py`, which provides the ESPNcricinfo IDs. `build_player_images.py` and `build_photo_byid.py` build the Cricbuzz headshot map (`playerimg.js`).

### ICC rankings
icc-cricket.com renders its tables with JavaScript, so this script uses a headless browser:
```
pip install playwright
python -m playwright install chromium
python scripts/fetch_icc_rankings.py            # live
python scripts/fetch_icc_rankings.py --debug    # also saves the rendered HTML of pages that parse empty
```
Covers men's and women's Test/ODI/T20I batting, bowling, all-rounder and team tables, and writes `web/dashboard/rankings.js`. The weekly GitHub Action runs it too; if ICC changes its markup, the run uploads the `--debug` pages as an artifact so the selectors can be updated.

## Live scores
`serve.py` (project root) serves the site locally plus `/api/live`, `/api/schedule`, `/api/results`, `/api/match` and `/api/commentary`, read from Cricbuzz's pages (no API key, no headless browser):
```
pip install requests
python serve.py        # http://127.0.0.1:5000
```
The public site uses the same code as a Vercel serverless function (`api/index.py`).
