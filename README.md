# Cricket Intelligence Lab

Ball-by-ball cricket analytics over open **[Cricsheet](https://cricsheet.org)** data —
a single, self-contained dashboard covering **48 competitions, 22,000+ matches and
11.2 million deliveries** of men's and women's cricket.

No build tools, no database server, no framework. The whole interactive app is a
static page plus a tiny Python helper for live data. Clone it, open one file, and it runs.

---

## Run it

### Just the dashboard (zero install)

Clone the repo and open **`web/dashboard/index.html`** in any modern browser. That's it —
every cohort, leaderboard, player profile, partnership, spell and comparison works fully
offline. Player photos load directly from Cricbuzz's CDN.

```bash
git clone https://github.com/<you>/cricket-intelligence-lab.git
cd cricket-intelligence-lab
# then double-click web/dashboard/index.html
```

### With live scores (optional, Python only)

**Live scores, schedule and commentary** are fetched in real time from Cricbuzz by a small
stdlib server. (Team records, career timelines and venue splits are pre-computed into static
files during the build, so they work *without* the server — only live scores need it.)

```bash
pip install requests
python serve.py            # then open http://127.0.0.1:5000
```

### Rebuild the data from scratch (optional)

The committed cohort bundles are pre-built. To regenerate them from the raw corpus,
download the full Cricsheet archive (`all_json.zip`) from
<https://cricsheet.org/downloads/> into the project root, then:

```bash
pip install orjson numpy
python build_all.py --zip all_json.zip
```

This streams every match out of the zip into `cil.db` (SQLite), recomputes all marts,
and writes the per-cohort dashboard bundles. It swaps the database in atomically and
runs `verify_build.py` at the end, so a half-built run can never leave you broken.

---

## Host it for free

`serve.py` reads `PORT` and binds `0.0.0.0`, so it deploys as-is. Easiest free host is
[Render](https://render.com): **New → Blueprint → pick this repo → Apply** (it reads
`render.yaml`). You get a public URL where the full dashboard *and* live scores work — no
install for visitors. (Free tier sleeps after ~15 min idle, so the first hit cold-starts.)

## Auto-updates (GitHub Actions)

Two scheduled workflows keep it current with zero manual work (free on public repos):

- **`rebuild-data.yml`** — weekly: downloads the latest Cricsheet corpus, rebuilds every
  cohort + `careers.js`, commits the result.
- **`update-rankings.yml`** — weekly: re-scrapes the ICC rankings.

Each commits only when something changed; Render auto-redeploys on push, so the live site
updates itself. Enable **Settings → Actions → General → Workflow permissions → Read and write**
so the jobs can commit.

---

## What's inside

| Area | What you get |
|---|---|
| **48 cohorts** | Men's & women's T20I / ODI / Test, plus IPL, BBL, PSL, The Hundred, CPL, county & domestic competitions — pick any from the top selector |
| **Batter & bowler intelligence** | Every player paginated and sortable; click for a full profile with percentile ranks, phase splits, context splits, similar players, career timeline and venue breakdown |
| **Records & leaderboards** | Runs, wickets, averages, strike rates, era-adjusted indices and more, each ranked by the value shown |
| **Partnerships & spells** | Biggest stands and best wicket-taking spells in every competition |
| **Outliers** | Batting (average ↔ strike rate) and bowling (economy ↔ strike rate) players furthest from the trend |
| **Compare** | Up to four players head-to-head — percentile radar, side-by-side splits, and shared bowler match-ups |
| **Similarity network** | Each batter linked to their nearest statistical peers across 12 metrics |
| **Venues & teams** | Ground scoring/result tendencies and team win-loss records |
| **Live** | Live scores, schedule and full match commentary, scraped from Cricbuzz in real time |
| **UX** | Command palette (Ctrl-K), shareable URL state, instant-boot lazy-loaded cohorts |

---

## How it works

```
all_json.zip ──► build_all.py ──► cil.db (SQLite) ──► per-cohort bundles ──► dashboard
 (Cricsheet)      stream + ETL      star schema        web/dashboard/cohorts/*.js   index.html
                                                                                     serve.py (live)
```

- **`build_all.py`** — one command: ingest the zip, compute marts, write bundles, verify.
- **`packages/etl`** — Cricsheet parser, streaming zip ingest, SQLite store.
- **`packages/analytics`** — metrics, percentiles, archetypes, similarity, outliers,
  records, partnerships and spells (`pipeline.py`).
- **`web/dashboard`** — the single-file app (`index.html`) and its lazy-loaded cohort
  bundles, player-photo map (`playerimg.js`) and cohort index (`index.js`).
- **`serve.py`** — stdlib HTTP server: serves the dashboard and exposes live/photo/career/
  venue/team endpoints. No web framework.
- **`scripts/`** — data-refresh helpers (player photos, Cricinfo enrichment, ICC rankings).

---

## Layout

```
build_all.py                 one-command build (zip -> SQLite -> bundles -> verify)
serve.py                     stdlib server: dashboard + live/photo/db endpoints
verify_build.py              post-build integrity gate
web/dashboard/index.html     the interactive dashboard
web/dashboard/cohorts/*.js   per-cohort data bundles (lazy-loaded)
web/dashboard/playerimg.js   Cricsheet-id -> Cricbuzz photo map
packages/etl/                Cricsheet ingest + SQLite store
packages/analytics/          all marts and per-cohort bundle builder
scripts/                     photo / rankings / enrichment refresh
docs/                        design spec + architecture decision records
```

---

## Requirements

- **Python 3.10+** (only for `serve.py` live data and rebuilding; the dashboard itself needs nothing)
- `pip install requests` for the live server
- `pip install orjson numpy` to rebuild from the zip

---

## Data & attribution

All data is from **[Cricsheet](https://cricsheet.org)**, released under the
**Open Data Commons Open Database License (ODbL) / CC BY-SA**. If you use this project or
its data, you must attribute Cricsheet and share alike. Player photos are fetched from
Cricbuzz for display only.
