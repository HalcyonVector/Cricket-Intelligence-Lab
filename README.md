# Cricket Intelligence Lab: Interactive Analytics Dashboard
Ball-by-ball cricket intelligence across **48 competitions, 22,000+ matches, and 11.2 million deliveries** from men's and women's cricket. Built as a single, self-contained dashboard with zero build tools, no database required, and no framework overhead: just open one HTML file and explore.
---
## Features
### Core Features
- **48 Sport Cohorts:** Men's & women's T20I / ODI / Test, plus IPL, BBL, PSL, The Hundred, CPL, county & domestic competitions; pick any from the top selector
- **Batter & Bowler Intelligence:** Every player paginated, sortable, and clickable for full profiles with percentile ranks, phase splits, context splits, and career timelines
- **Records & Leaderboards:** Runs, wickets, averages, strike rates, era-adjusted indices; each ranked by the value shown
- **Partnerships & Spells:** Biggest stands and best wicket-taking spells across every competition
- **Outliers Detection:** Batting (average ↔ strike rate) and bowling (economy ↔ strike rate) players plotted against trend lines
- **Player Comparison:** Head-to-head analysis for up to four players with percentile radar, side-by-side splits, and shared bowler match-ups
- **Similarity Network:** Each batter linked to their nearest statistical peers across 12 metrics
- **Venue & Team Analytics:** Ground scoring/result tendencies and team win-loss records
- **Live Scores & Commentary:** Real-time scores, match schedule, and full ball-by-ball commentary from Cricbuzz
- **Command Palette & Search:** Ctrl-K for instant player lookup, shareable URL state for reproducible links
### Dashboard Sections
- **Landing Page:** Animated marketing front page (`web/landing.html`) with a scroll-driven gradient and editorial type; served at `/` when hosted and links through to the dashboard
- **Cohort Selector:** Switch between competitions in one click; all data pre-computed and offline-ready
- **Leaderboard Grid:** Sortable player tables with clickable profiles
- **Player Profiles:** Historical timeline, venue breakdown, phase splits (powerplay/middle/death), archetype radar
- **Records Panel:** Top runs, wickets, averages, and strike rates ranked by category
- **Venues & Teams:** Scoring patterns, result tendencies, and head-to-head records
- **Comparison Tool:** 4-player radar, shared bowler/batter match-ups, split breakdowns
- **Live Feed:** Inbound scores, schedule, and commentary (when live server is running)
### Data Coverage
- **Time Series:** Career timelines, phase evolution, era-adjusted metrics
- **Context:** Venue splits, opposition splits, condition-dependent performance
- **Aggregates:** Career totals, phase averages, era-relative percentiles
- **Discovery:** Similar players network, outlier detection, partnership records
---
## Tech Stack
| Component | Technology | Details |
|-----------|-----------|---------|
| **Dashboard** | HTML + Vanilla JavaScript | Single-file interactive app; zero build step required |
| **Data Format** | Lazy-loaded JSON bundles | Pre-computed per-cohort (.js), ~500KB each when gzipped |
| **Backend (optional)** | Python 3.10+ stdlib | Minimal stdlib HTTP server; only for live data |
| **Live Data Source** | Cricbuzz scraper | Requests library for real-time scores |
| **Build System** | Python + ETL pipeline | Batch ingest from Cricsheet zip → SQLite → per-cohort bundles |
| **Styling** | Plain CSS | Responsive dark theme with minimal dependencies |
| **Storage** | SQLite (ephemeral) | cil.db used only during build; all production data is static bundles |
---
## Prerequisites
- **Modern browser:** Chrome, Firefox, Safari, or Edge (for the dashboard; no install needed)
- **Python 3.10+:** [Download here](https://www.python.org/downloads/) (optional, only for live scores and rebuilding data)
- **Cricsheet archive:** [Download from cricsheet.org](https://cricsheet.org/downloads/) (optional, for custom rebuilds)
---
## Quick Start (3 Options)
### Option 1: Just the Dashboard (Zero Install) ->Fastest
Simply clone the repo and open the HTML file:

```bash
git clone https://github.com/HalcyonVector/Cricket-Intelligence-Lab.git
cd Cricket-Intelligence-Lab
# open web/landing.html for the front page, or web/dashboard/index.html to go straight to the app
```

All cohorts, leaderboards, player profiles, and comparisons work fully offline. Player photos load from Cricbuzz's CDN.

### Option 2: With Live Scores (Python Required)
Enable real-time scores, schedule, and commentary from Cricbuzz:

```bash
pip install requests
python serve.py
# then open http://127.0.0.1:5000
```

`serve.py` serves the `web/` folder: the **landing page** is at `/` and the **dashboard** at `/dashboard/`. The server binds to `0.0.0.0:5000`. Historical analytics remain static; only live data is streamed.

### Option 3: Rebuild from Raw Data (Full Rebuild)
Download the latest Cricsheet corpus and regenerate all cohort bundles:

```bash
pip install requests orjson numpy
# Download all_json.zip from https://cricsheet.org/downloads/ into the project root
python scripts/build_all.py --zip all_json.zip
python serve.py
```

This streams every match into SQLite, recomputes all analytics, and rebuilds the per-cohort bundles atomically with a verification gate.
---
## Detailed Setup Instructions
### macOS / Linux
```bash
# 1. Clone the repository
git clone https://github.com/HalcyonVector/Cricket-Intelligence-Lab.git
cd Cricket-Intelligence-Lab

# 2. (Optional) Install Python dependencies for live data
pip install requests orjson numpy

# 3a. Just view the dashboard offline
open web/dashboard/index.html

# 3b. Or start the live server
python serve.py  # http://127.0.0.1:5000
```
### Windows
```bash
# 1. Clone the repository
git clone https://github.com/HalcyonVector/Cricket-Intelligence-Lab.git
cd Cricket-Intelligence-Lab

# 2. (Optional) Install Python dependencies
pip install requests orjson numpy

# 3a. Just view the dashboard offline
# Double-click: web\dashboard\index.html in File Explorer

# 3b. Or start the live server
python serve.py  # http://127.0.0.1:5000
```
---
## Project Structure
```
Cricket-Intelligence-Lab/
├── serve.py                       # Stdlib server: static site + live/photo/career API
├── requirements.txt               # Runtime deps for serve.py (Render installs this)
├── render.yaml                    # Render deployment blueprint
│
├── packages/
│   ├── etl/cil_etl/
│   │   ├── ingest_zip.py          # Stream Cricsheet zip -> SQLite
│   │   ├── parse.py               # Cricsheet JSON parsing
│   │   └── store.py               # SQLite schema
│   └── analytics/cil_analytics/
│       └── pipeline.py            # All per-cohort analytics -> bundles
│
├── scripts/
│   ├── build_all.py               # One command: zip -> SQLite -> bundles -> verify
│   ├── verify_build.py            # Post-build integrity gate
│   ├── fetch_icc_rankings.py      # ICC rankings -> web/dashboard/rankings.js
│   ├── enrich_players_cricinfo.py # Countries + Cricinfo links -> playermeta.js
│   ├── build_player_images.py     # Player photo map -> playerimg.js
│   └── build_photo_byid.py        # Photo map keyed by Cricsheet id
│
├── web/
│   ├── landing.html               # Landing page (served at /)
│   ├── shots/                     # Screenshots used on the landing page
│   └── dashboard/
│       ├── index.html             # The whole app (served at /dashboard/)
│       ├── index.js               # Cohort manifest (instant boot)
│       ├── cohorts/*.js           # 48 lazy-loaded cohort bundles
│       ├── careers.js, rankings.js, playermeta.js, playerimg.js
│       └── live.js, schedule.js   # Live scores / fixtures (needs serve.py)
│
├── tests/                         # Parser unit tests
├── docs/                          # ADR + original design spec
└── .github/workflows/             # Weekly data rebuild + ICC rankings refresh
```
---
## Data & Methodology
### Source
All cricket data is from **[Cricsheet](https://cricsheet.org)**, released under the **Open Data Commons Open Database License (ODbL) / CC BY-SA**. Player photos are fetched from Cricbuzz's CDN for display only.

### Cohorts Included
| Category | Competitions |
|----------|--------------|
| **Internationals** | T20I, ODI, Test (men's & women's) |
| **Domestic T20** | IPL, BBL, PSL, The Hundred, CPL, BPL, CPL, CPLT20, SMAT, TVL |
| **Domestic 50-over** | Royal London One-Day Cup, ODD, Syed Mushtaq Ali Trophy |
| **County** | County Championship, Royal London One-Day Cup |
| **Other** | Caribbean Premier League, Bangabandhu BPL |

### Metrics Calculated
- **Batting:** Runs, HS, Avg, SR, 4s, 6s, dots %, boundaries %
- **Bowling:** Wickets, Runs, Econ, Avg, SR, BBI, Maidens, Dot %
- **Contextual:** Powerplay splits, middle/death phases, venue-specific, opposition-specific
- **Comparative:** Percentiles (era-adjusted), archetype clustering, similarity network (12 dimensions)

### Build Pipeline
```
all_json.zip (Cricsheet)
    ↓
scripts/build_all.py streams JSON into SQLite
    ↓
packages/analytics/pipeline.py computes metrics, percentiles, similarity, records
    ↓
Per-cohort .js bundles generated (lazy-loaded)
    ↓
scripts/verify_build.py gates integrity
    ↓
web/dashboard/index.html loads bundles on demand
```
---
## Deployment
### Local (Free)
```bash
python serve.py  # Runs on http://127.0.0.1:5000
```

### Render (Free, Auto-Deploy)
1. Push to GitHub
2. Go to [render.com](https://render.com) → **New → Blueprint**
3. Select this repo → **Apply**
4. `render.yaml` configures the build; Render auto-deploys on push

Once live, the **landing page** is at the site root (`/`) and the **dashboard** at `/dashboard/`. The free tier sleeps after ~15 min idle; first hit will cold-start (~30s).

### GitHub Actions Auto-Updates
Two workflows run weekly at no cost:

| Workflow | Trigger | Action |
|----------|---------|--------|
| `rebuild-data.yml` | Weekly | Download latest Cricsheet, rebuild all bundles, auto-commit if changed |
| `update-rankings.yml` | Weekly | Re-scrape ICC rankings, auto-commit |

Enable **Settings → Actions → General → Workflow permissions → Read and write** so workflows can commit.
---
## Available Scripts
| Script | Command | Description |
|--------|---------|-------------|
| **Build from scratch** | `python scripts/build_all.py --zip all_json.zip` | Ingest Cricsheet archive, recompute all analytics, regenerate bundles |
| **Start live server** | `python serve.py` | Serve dashboard at localhost:5000 + live/photo/career endpoints |
| **Verify integrity** | `python scripts/verify_build.py` | Post-build gate: check bundle schemas, cohort consistency, data completeness |
| **Update photos** | `python scripts/build_player_images.py` | Rebuild the player photo map |
| **Update rankings** | `python scripts/fetch_icc_rankings.py` | Fetch latest ICC rankings (needs Playwright) |
| **Player metadata** | `python scripts/enrich_players_cricinfo.py` | Countries + ESPNcricinfo links |

See [scripts/README.md](scripts/README.md) for setup details.

--------|---------|-------------|
| **Build from scratch** | `python scripts/build_all.py --zip all_json.zip` | Ingest Cricsheet archive, recompute all analytics, regenerate bundles |
| **Start live server** | `python serve.py` | Serve dashboard at localhost:5000 + live/photo/career endpoints |
| **Verify integrity** | `python scripts/verify_build.py` | Post-build gate: check bundle schemas, cohort consistency, data completeness |
| **Update photos** | `python scripts/update-photos.py` | Re-scrape Cricbuzz for fresh player photos |
| **Update rankings** | `python scripts/update-icc-rankings.py` | Fetch latest ICC rankings |

---
## Troubleshooting
### Issue: `FileNotFoundError: all_json.zip`
**Solution:** Download the Cricsheet archive from https://cricsheet.org/downloads/, place it in the project root, and retry:
```bash
python scripts/build_all.py --zip all_json.zip
```

### Issue: `ModuleNotFoundError: requests` or `orjson`
**Solution:** Install dependencies:
```bash
pip install requests orjson numpy
```

### Issue: Port 5000 already in use
**Solution:** Set the `PORT` environment variable:
```bash
PORT=8080 python serve.py
```

### Issue: Dashboard loads but no player photos appear
**Solution:** Ensure you have internet access (photos load from Cricbuzz CDN). If offline, photos won't load but analytics remain fully functional.

### Issue: Live scores not updating / blank feed
**Solution:** Confirm the live server is running (`python serve.py`) and check the browser's Network tab for `/api/live` requests. The Cricbuzz scraper may be rate-limited; retry after a few minutes.

### Issue: Cohort bundle is corrupted / old data showing
**Solution:** Clean and rebuild:
```bash
rm -f cil.db
python scripts/build_all.py --zip all_json.zip
python scripts/verify_build.py
```

---
## Future Enhancements
- [ ] Streaming live database (instead of rebuilding weekly)
- [ ] Custom stat definitions (allow users to define derived metrics)
- [ ] Interactive prediction model (win probability, score forecasts)
- [ ] Mobile-optimized responsive UI
- [ ] Player injury/form timeline
- [ ] Venue-specific weather integration
- [ ] Multi-season trend analysis with year-on-year comparison
- [ ] Collaborative filtering for player recommendations
- [ ] Dark/light theme toggle

---
## Author
**Sagnik**  
GitHub: [@HalcyonVector](https://github.com/HalcyonVector)  

---
## Support
Found a bug or have a feature request?  
[Open an issue](https://github.com/HalcyonVector/cricket-intelligence-lab/issues) on GitHub.

---
## License & Attribution
**Data Attribution:** All cricket data is from [Cricsheet](https://cricsheet.org) under **ODbL / CC BY-SA**. If you use this project or its data, you must attribute Cricsheet and share alike.

**Project License:** No specific license. Contact the authors for usage rights.

---

