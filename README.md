# Cricket Intelligence Lab

Ball-by-ball cricket analytics across **49 competitions, 23,000+ matches and 11.7 million deliveries**, men's and women's. A static dashboard (plain HTML + JavaScript, no framework, no build step) fed by a weekly Python pipeline over [Cricsheet](https://cricsheet.org)'s open data.

**Live site:** https://halcyonvector.github.io/Cricket-Intelligence-Lab/

---
## Features

**Players**
- **Batter and bowler profiles:** percentiles, archetypes, phase and context splits, most similar players, best and worst matchups, by-venue records
- **Form by year:** runs, average or strike rate (wickets, economy or strike rate for bowlers) per season, for the selected competition or all competitions
- **Where they stand:** each key stat drawn against every rated player in the competition, so "96th percentile" shows how far ahead that really is
- **Also played in:** every other competition a player appears in, one click away
- **Photos:** Cricbuzz headshots, with Wikimedia Commons photos (credited) for players Cricbuzz's map misses

**Analysis**
- **Time window:** "All time", "Last 2 seasons", "Since 2015"… recomputes leaderboards, records, percentiles, archetypes and profile numbers for that window
- **Full members only** (international competitions): counts only matches between the 12 ICC full members, so figures built against associate nations don't top the boards. Works with the time window, Matchups and Bowl to…
- **Matchups:** any batter against any bowler with 12+ balls between them (18 in Tests)
- **Who should bowl to…:** pick a batter and a phase; get the bowlers with the best record against them and the best options for that phase
- **Records, outliers, research lab, similarity network, 4-player comparison**
- **Bowler archetypes:** Strike bowler, Holder, Powerplay specialist, Death specialist, Workhorse

**Teams, grounds and matches**
- **Team pages:** win % by year, head-to-head against every opponent, top run-scorers and wicket-takers
- **Venue pages:** first-innings average by year, toss effect, top performers, recent matches
- **Match pages:** the latest 40 matches per competition with run progression, runs per over, batting/bowling summaries and a **win-probability** line
- **Win probability:** logistic models per format and gender trained on every T20 and ODI in the data; also shown as a live win chance on T20/ODI score cards
- **Home:** standout innings and spells from the newest data, and a milestone watch (active players close to a round number)

**Everywhere**
- **Search across all competitions** (Ctrl/⌘-K for the command palette), shareable URLs for every view
- **Metric explanations:** a "?" next to era index, clutch index, dominance and the rest
- **Live scores, schedule and ball-by-ball commentary** via Cricbuzz, served by a small API on Vercel
- **Coverage notes:** the site explains what Cricsheet's data doesn't include (see Data and methodology)
- **Works offline and installs as an app;** keyboard-accessible; bottom tab bar on phones

---
## Quick start

```bash
git clone https://github.com/HalcyonVector/Cricket-Intelligence-Lab.git
cd Cricket-Intelligence-Lab
python scripts/fetch_data.py   # downloads the latest built data (~25 MB)
python serve.py                # http://127.0.0.1:5000
```

The generated data isn't committed to git (it would grow the repo by ~100 MB a week). The weekly build publishes it as the [`data-latest` release](https://github.com/HalcyonVector/Cricket-Intelligence-Lab/releases/tag/data-latest), and `fetch_data.py` pulls it into `web/dashboard/`. Without `serve.py` you can also open `web/dashboard/index.html` directly; everything except live scores works.

### Rebuild the data yourself
```bash
pip install orjson numpy
# download all_json.zip from https://cricsheet.org/downloads/ into the project root
python scripts/build_all.py --zip all_json.zip
```
This streams every match into SQLite (`cil.db`), recomputes all analytics, writes the bundles atomically and runs the integrity check.

---
## How it's hosted (all free)

| Piece | Where | Notes |
|-------|-------|-------|
| Dashboard + landing page | **GitHub Pages** | Global CDN, compressed, never sleeps |
| Weekly data build | **GitHub Actions** (`site.yml`) | Mondays 05:00 UTC: Cricsheet → bundles → ICC rankings → `data-latest` release → Pages |
| Code deploys | **GitHub Actions** (`site.yml`) | Any push touching `web/` redeploys with the latest data, no rebuild |
| Checks | **GitHub Actions** (`ci.yml`) | Every push/PR: compile, unit + pipeline smoke tests, JS syntax, a ~440,000-check data audit, and a headless-browser test of 19 views |
| Data gate | **GitHub Actions** (`site.yml`) | The weekly build runs the same data audit before publishing anything |
| Live scores API | **Vercel** serverless function (`api/index.py`) | Runs `serve.py`'s `/api/*`; starts in ~1 s, CDN-cached (live 30 s, schedule 10 min) so most requests never run Python |

### One-time setup
1. **Settings → Pages → Source: GitHub Actions.**
2. **Actions → Build data & deploy site → Run workflow** (with "Rebuild data" ticked) to publish the first data release and deploy.
3. **Live scores:** on [vercel.com](https://vercel.com) → Add New → Project → import this repo → Deploy (`vercel.json` sets everything). Then add a repository variable **`LIVE_API_URL`** = your Vercel URL (Settings → Secrets and variables → Actions → Variables) and re-run the workflow. Without it the site works fully except the Live tabs, which say the live server isn't connected.

---
## Project structure
```
Cricket-Intelligence-Lab/
├── serve.py                       # Stdlib server: static site + live/photo API (gzip + ETags)
├── requirements.txt               # Runtime deps for serve.py / the Vercel API
├── packages/
│   ├── etl/cil_etl/               # Cricsheet zip -> SQLite (ingest_zip.py, parse.py, store.py)
│   └── analytics/cil_analytics/
│       ├── pipeline.py            # Per-cohort analytics -> core + detail bundles, matchups, careers, players index
│       ├── extras.py              # Per-season stats, venue/team/match detail, latest 30 days, full-member scope
│       └── winprob.py             # Win-probability models (T20/ODI, men/women)
├── scripts/
│   ├── build_all.py               # One command: zip -> SQLite -> bundles -> verify
│   ├── verify_build.py            # Post-build integrity gate
│   ├── fetch_data.py              # Download the latest built data
│   ├── fetch_icc_rankings.py      # ICC rankings (Playwright)
│   ├── enrich_players_cricinfo.py # Countries + ESPNcricinfo links -> playermeta.js
│   ├── build_photo_wikidata.py    # Wikimedia Commons photos via Wikidata -> playermeta.js
│   └── build_player_images.py, build_photo_byid.py   # Cricbuzz photo maps
├── web/
│   ├── landing.html, og.png, favicon.svg, shots/
│   └── dashboard/
│       ├── index.html             # Core app (served at /dashboard/)
│       ├── features.js            # Time window, bowler depth, Bowl to, venue/team/match pages, search, glossary
│       ├── sw.js, manifest.webmanifest, config.js
│       ├── playermeta.js, playerimg.js
│       └── (generated, not in git) index.js, rankings.js, players.js, winprob.js,
│           cohorts/<key>.js (core), cohorts/d/ (profile detail), cohorts/matchups/, cohorts/x/, careers/
├── api/, vercel.json, vercel/     # Live-scores API on Vercel (wraps serve.py)
├── tests/                         # Unit + pipeline smoke tests, data_consistency.py, browser/smoke.py
└── docs/                          # ADR + original design spec
```

---
## Data and methodology
All cricket data is from **[Cricsheet](https://cricsheet.org)** under the **Open Data Commons Open Database License (ODbL)**. Player photos come from Cricbuzz's CDN (display only) and Wikimedia Commons (credited, under each file's licence).

**What the data doesn't include**, so totals can be below official career figures:
- Ball-by-ball coverage starts in 2001 for men's internationals and 2003 for women's; leagues from their first covered season.
- Cricsheet withholds every match involving Afghanistan ([their explanation](https://cricsheet.org/article/explanation-for-withholding-of-afghanistani-matches/): a protest over Afghan women's cricket).
- Some matches are [missing from Cricsheet's archive](https://cricsheet.org/missing/), and domestic first-class/List A competitions they don't cover (e.g. Ranji Trophy) aren't here at all.


- **Batting counts** every delivery except wides (runs and balls off no-balls count); **bowling balls** exclude wides and no-balls.
- **Qualifiers:** counting stats include everyone; rate stats, percentiles and archetypes use a format-aware ball floor (T20 60, ODI 150/120, Test 300). Outlier flags need 3× that sample.
- **Era-adjusted index:** runs against what an average batter would score on the same balls in the same seasons (100 = par).
- **Dominance:** a batter-vs-bowler score from 0 to 1 combining scoring rate and dismissal rate, shrunk toward 0.5 for small samples.
- **Win probability:** two logistic models per format and gender (first innings: runs, balls, wickets; chase: runs needed, balls left, wickets) fitted on every end-of-over state; held-out Brier score about 0.21 / 0.12. They don't know the teams, pitch or rain rules.
- **Filters (time window, full members only):** rebuilt in the browser from per-season totals; percentiles and archetypes are recomputed for the selection, advanced metrics and similarity stay unfiltered.

```
all_json.zip ─► scripts/build_all.py ─► cil.db (SQLite) ─► pipeline.py + extras.py
   ─► cohorts/*.js, d/, matchups/, x/, careers/, players.js, winprob.js ─► verify_build.py ─► data_consistency.py
   ─► data-latest release ─► GitHub Pages
```

---
## Scripts
| Task | Command |
|------|---------|
| Get the latest data | `python scripts/fetch_data.py` |
| Run locally with live scores | `python serve.py` (set `PORT` to change from 5000) |
| Rebuild from Cricsheet | `python scripts/build_all.py --zip all_json.zip` |
| Verify a build | `python scripts/verify_build.py` and `python tests/data_consistency.py` |
| Browser smoke test | `pip install playwright && python -m playwright install chromium && python tests/browser/smoke.py` |
| Run tests | `pip install pytest numpy orjson && python -m pytest -q tests` |
| ICC rankings | `python scripts/fetch_icc_rankings.py` (needs Playwright) |
| Player metadata / photos | `python scripts/enrich_players_cricinfo.py`, then `python scripts/build_photo_wikidata.py` |

---
## Troubleshooting
- **Dashboard says "No data found":** run `python scripts/fetch_data.py` (or build it yourself).
- **`ModuleNotFoundError: orjson`/`numpy`:** `pip install orjson numpy` (only needed for building).
- **Live tab is empty:** Cricbuzz may be rate-limiting or changed its pages; the page retries automatically. Check `https://cricket-intelligence-lab.vercel.app/api/live`.
- **A player's totals look low:** see "What the data doesn't include" above.
- **Old data after a rebuild:** reload once; the offline cache always fetches the latest files first.

---
## Future ideas
- [ ] Score forecasts (projected totals) alongside win probability
- [ ] Custom stat definitions
- [ ] Venue-specific weather integration

---
## Author
**Sagnik** · GitHub [@HalcyonVector](https://github.com/HalcyonVector) · [Open an issue](https://github.com/HalcyonVector/Cricket-Intelligence-Lab/issues)

## License and attribution
**Data:** [Cricsheet](https://cricsheet.org), ODbL. If you reuse the data, attribute Cricsheet and share alike.
**Code:** no license specified yet; contact the author for usage rights.
