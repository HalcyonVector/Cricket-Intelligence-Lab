# Cricket Intelligence Lab — Handoff / Status (resume here)

Last updated: 2026-06-23 (session 2). This doc lets a fresh chat pick up exactly where we left off.

## SESSION 2 progress (code done in sandbox; data steps need the user to run locally)
The sandbox has NO network to cricsheet/ESPN/ICC (only pypi), so anything that hits
those domains must be run on the user's Windows machine. All code that doesn't need
network was completed and verified this session:
- **serve.py REWRITTEN** (issue B): dropped the broken `python-espncricinfo`. Now drives
  ESPN's consumer JSON API via Playwright Chromium, funnelled through ONE dedicated
  browser worker thread + job queue (sync Playwright is thread-affine; ThreadingHTTPServer
  is not). Defensive parser `_extract_matches` handles `matches` / `content.matches` /
  deep-fallback; `_team_list` builds "180/4 (18.2)" from `score.innings`. Verified against
  synthetic payloads — output matches the dashboard's expected live/schedule shapes.
  Setup is now `pip install playwright` + `python -m playwright install chromium` (NOT webkit).
- **scripts/probe_espn_api.py NEW** (issue B): Playwright probe that prints the shape of the
  live/player endpoints and tries 4 schedule-endpoint candidates, reporting which returns
  fixtures. `--raw` dumps full JSON. Run this FIRST, paste output, then confirm/adjust
  serve.py field paths (schedule endpoint is the one unknown).
- **.gitignore** (issue D): added `.cache/`, `scripts/_debug_*.html`, `scripts/_espn_*.json`.
- **scripts/README.md**: section 3 updated to the Playwright approach + new probe.
- **ICC script (issue A) — FIXED & VERIFIED**: first live run returned 0 rows because the
  parser looked for `<table>/<tr>`, but ICC renders rankings as a `.si-` widget of
  `<div class="si-table-row">`. Rewrote the extractor (`_SI_JS` + `rows_from_si`) to read
  `.si-pos / .si-player(.si-fname+.si-lname) / .si-team(.si-fname) / .si-rating`, with
  tie carry-forward (tied ranks show pos as a bare "="). Old token parser kept as fallback.
  Verified against the 4 saved `scripts/_debug_*.html`: ODI Batting 100 rows (Mitchell #1,
  Kohli #2), Test Batting (Brook #1), Test Bowling (Bumrah #1), Test AR (Jadeja #1). User
  just re-runs `python scripts/fetch_icc_rankings.py` (no --debug needed).
- **LIVE/SCHEDULE (issue B) — DONE & VERIFIED, now via CRICBUZZ**: ESPN was abandoned
  (consumer API blocks headless navigation; innerText returns non-JSON). User pointed to
  github.com/tarun7r/Cricket-API which scrapes Cricbuzz. Cricbuzz's old `cb-*` classes are
  ALSO dead (site rebuilt as a Next.js app) — BUT the rebuilt pages inline the full match
  list as JSON inside `self.__next_f.push([...])` chunks. So `serve.py` was REWRITTEN to do
  a plain `requests` GET and extract that JSON (functions `_decode_next_stream` +
  `_balanced_objects` + `_matches_from_html`). **No browser, no API key — just
  `pip install requests`.** Each match = `{matchInfo, matchScore}`:
  matchInfo has team1/team2{teamName,teamSName,imageId}, seriesName, matchFormat, state,
  status, shortStatus, startDate(epoch ms), venueInfo{ground,city,timezone}; matchScore has
  team{1,2}Score.inngs{1,2}{runs,wickets,overs}. Endpoints now: `/api/live` (state in
  In Progress/Toss/Innings Break/etc), `/api/schedule` (Preview/Upcoming, sorted), `/api/results`
  (Complete), `/api/_debug`. Verified against the saved `scripts/_cb_live.html`: 31 matches →
  1 live (Panama v Brazil, toss), 11 upcoming with venues, 19 results with scores
  (e.g. "MI New York won by 8 wkts", 162/2 (17.4)). Output matches the dashboard's expected
  live/schedule shapes. `serve.py` no longer needs Playwright at all.
- **PLAYER STATS + PHOTOS (full-leverage) — endpoint DONE & parser VERIFIED**: from the
  saved Kohli profile (`scripts/_cb_player.html`) the profile JSON lives in the same next_f
  stream. `serve.py` now has `/api/player?name=|url=|id=` and `/api/photo?name=|url=|id=`.
  `_parse_player` pulls `playerData` (name, intlTeam, role, bat/bowl style, DoB, image,
  rankings{bat,bowl,all}) + `playerBattingStats`/`playerBowlingStats` (headers + values →
  {format:{metric:val}}). Verified: Kohli India/Batsman, image
  https://i.cricketcb.com/stats/img/faceImages/1413.jpg, Test/ODI/T20/IPL batting+bowling,
  ICC ranks. Photo also derivable as static.cricbuzz.com/a/img/v1/152x152/i1/c<faceImageId>/x.jpg.
  TWO THINGS LEFT: (1) name->profile resolution (`resolve_profile`) uses Cricbuzz search
  then googlesearch; the `?url=` path is verified but `?name=` needs a LIVE test (Cricbuzz
  search parsing couldn't be tested from the sandbox). (2) Dashboard wiring: index.html player
  profiles don't yet call /api/player — needs the Players/profile view to fetch by name and
  render the Cricbuzz stats/photo block.
- **probe_espn_api.py / probe_cricinfo.py**: now dead-ends, kept for reference only.

### What the USER still needs to run locally (network required):
1. `python scripts/enrich_players_cricinfo.py`  → restores playermeta.js (currently the
   66-byte demo stub). ~5 sec.
2. `python scripts/fetch_icc_rankings.py`  → ICC Rankings tab (parser fixed; DONE per user).
3. `pip install requests` then `python serve.py`  → open http://127.0.0.1:5000 — Live Scores,
   Schedule, Results all work now (Cricbuzz, no browser needed).
4. (Full-leverage, optional) open one Cricbuzz profile in a browser and run
   `python scripts/probe_cricbuzz.py --profile-url <that URL>` so the player-stats/photo
   parser can be built.
5. Git: index is CORRUPT on the mount (`bad signature` / `index file corrupt`). Fix per the
   "Git push prep" steps below (nuke `.git`, fresh init).


## What this project is
A static, single-file dashboard (`web/dashboard/index.html`) over Cricsheet ball-by-ball
data, plus a Python ETL/analytics pipeline that produces per-cohort data bundles, plus
optional scripts/server for external data (ICC rankings, ESPNcricinfo live/schedule/photos).

## Architecture (how it fits together)
- **ETL**: `packages/etl/cil_etl/` ingests `all_json.zip` (Cricsheet, ~22k matches) into
  SQLite `cil.db`. Key fix already done: classify by `team_type` (international vs club)
  and normalize format (T20+IT20→t20, ODI+ODM→odi, Test+MDM→test). Ingests EVERYTHING.
- **Analytics**: `packages/analytics/cil_analytics/pipeline.py` builds 48 cohorts
  (6 international + ~42 club leagues) and writes:
  - `web/dashboard/cohorts/<key>.js`  (each calls `window.__cohortLoaded(key, {...})`)
  - `web/dashboard/index.js`  (`window.CIL_INDEX` = cohort metadata; instant boot)
  - `web/data/<key>.json`  (same bundles, for an optional API; gitignored)
- **Dashboard**: `web/dashboard/index.html` — lazy-loads cohorts via `<script>` injection,
  fully works by double-clicking (file://). Tabs: Home, Live Scores, Schedule, Players,
  Compare, Matchups, Research Lab, Records, Venues, (ICC Rankings if data present).
- **Build**: `python build_all.py --zip all_json.zip` runs ETL + analytics.
- **Optional external data** (`scripts/` + `serve.py`): see "Open issues" below.

## Build environment note (IMPORTANT for the assistant)
The repo lives on a Windows-mounted folder accessed from a Linux sandbox. Constraints hit
repeatedly:
- The sandbox **cannot delete** files on the mount (`rm` → "Operation not permitted").
  It CAN create and overwrite. So clean rebuilds were done in `/tmp/out*` then copied over.
- The file-edit tool sometimes **didn't flush** to the mount (truncated writes). Writing
  Python/HTML via `cat > file <<'EOF'` (bash heredoc) is reliable; prefer that for big files.
- Each bash call has a **45s timeout** and background processes don't persist between calls.
  Long jobs (full ingest, full pipeline build) were run in **resumable chunks**:
  - ingest supports `--start/--count`; pipeline `build()` **skips cohorts whose json already
    exists**, so re-running the build repeatedly finishes it across many 45s calls.
- The DB used during the session was at `/tmp/cil.db` (sandbox local, ~2GB). On the user's
  machine, run `build_all.py` to (re)create `cil.db`.

## DONE and verified
1. **Data classification fixed** — Men's T20Is now 3,633 matches through 2026 (was 240
   ending 2024); Indian venues present (Eden Gardens, Wankhede, Narendra Modi…). 22,062
   matches / ~11.3M deliveries ingested. 48 cohorts.
2. **Thresholds removed** — player tables/records show everyone (paginated); only rate-stat
   leaderboards use a light, format-aware floor (t20 60 balls / odi 150 / test 300). Records
   are top-15-per-card with prev/next pagination; dashboard applies a 2× display floor to
   rate leaderboards so tiny-sample flukes don't top them.
3. **UI** — fresh dark theme, two-row responsive header (brand+Live pill / nav), single
   aligned sortable+paginated table component (`dataTable`) used by Players & Venues (this
   FIXED a broken venues table), proper filter controls (search + Archetype dropdown +
   segmented "Rated only" toggle). Lazy-load per cohort.
4. **Venue dedup** — "Eden Gardens" / "Eden Gardens, Kolkata" merged (canonicalize on text
   before first comma) in the pipeline.
5. **Advanced metrics** (all from ball-by-ball, in pipeline + player profile + Records +
   Research Lab axes): strike rotation %, singles %, acceleration index, pressure SR,
   clutch index, win-SR ratio, era-adjusted index (bat+bowl), **collapse resistance**
   (SR when 3+/4+ wkts down, via K-th-wicket fall-point join), **partnership dependence**
   (Herfindahl concentration over partners + names top partner). Validated against known
   players (e.g. Kohli chase avg 65.2, top ODI partner = Rohit Sharma).
   - NOTE: the heaviest first-class cohort (County Championship, 2.4M balls) **skips**
     era-index + collapse to stay within compute budget (`ERA_MAX = 1_900_000` in
     pipeline.py). Those show "—" there; all international + T20 cohorts have the full set.
6. **Player enrichment WORKS**: `scripts/enrich_players_cricinfo.py` uses Cricsheet's own
   `register/people.csv` (exact ID match) → wrote `web/dashboard/playermeta.js` with 12,969
   players having ESPNcricinfo IDs + names + country. Profiles show country badge + an
   ESPNcricinfo link. (The session's testing overwrote playermeta.js with a demo — user just
   needs to re-run this 5-sec script to restore.)
7. **Git push prep** — `.gitignore` written (excludes all_json.zip, cil.db, web/data/,
   web/dashboard/data.js, __pycache__, node_modules). The original single "Initial Commit"
   had the 778MB cil.db + 136MB zip baked in AND the git index got corrupted on the mount.
   **Recommended fix given to user**: nuke `.git`, `git init` fresh, `git add .` (respects
   .gitignore), commit, `git remote add origin <repo>`, `git push -u origin main --force`.
   Remote: https://github.com/HalcyonVector/Cricket-Intelligence-Lab  (branch: main).
   Cohort bundles (~64MB total, largest 10MB) ARE committed so the site works on clone.

## Dashboard UI for live/photos — DONE and tested (data side pending)
- Tabs **Live Scores** and **Schedule** added (after Home). They call `loadFeed(kind)`:
  use `window.CIL_LIVE` / `window.CIL_SCHEDULE` if present (snapshot), else `fetch('/api/'+kind)`
  when served over http, else show a setup hint. Render verified with demo data via jsdom.
- **Player photos**: avatar with initials fallback (`avatarHTML`); `<img>` src is
  `/api/photo?cricinfo_id=<id>` when served over http (onerror → initials). Verified.
- Expected data shapes the dashboard renders:
  - live:  `{generated, matches:[{series,title,status,format,teams:[{name,score}],note}]}`
  - schedule: `{generated, matches:[{date,time,title,series,venue}]}`
- Optional snapshot script tags already in index.html head: `live.js`, `schedule.js`
  (currently placeholders), plus `playermeta.js`, `rankings.js`.

## OPEN ISSUES — pick up here tomorrow

### A. ICC rankings script — JUST FIXED, needs a re-test
`scripts/fetch_icc_rankings.py` renders icc-cricket.com with Playwright (Chromium) and parses.
Two bugs were fixed this session:
  1. The injected JS used a **regex literal** → Playwright threw "Invalid regular expression:
     missing /". Rewritten to a **cell-based extractor** (`td/th/[role=cell]`, no regex).
  2. `wait_until="networkidle"` **timed out** (ICC keeps connections open). Changed to
     `domcontentloaded` + `wait_for_selector('table tr, [role="row"]')` + 900ms settle.
Correct URL structure (verified): players `/rankings/{batting|bowling|allrounder}/{mens|womens}/{format}`,
teams `/rankings/team-rankings/{gender}/{format}`; women's Test does not exist (skipped).
**ACTION**: user re-runs `python scripts/fetch_icc_rankings.py`. If a page still parses 0 rows,
run with `--debug` (saves `scripts/_debug_*.html`) and inspect the row/cell DOM to adjust
the selector in `_ROW_JS` / `rows_from_tokens`.

### B. Live / Schedule / Photos — python-espncricinfo is BROKEN for the user
`scripts/probe_cricinfo.py` output showed BOTH `Summary()` and `Player()` failing
("'NoneType' object is not subscriptable" / "has no attribute 'find_all'") — the package's
own fetching doesn't work in the user's env. So **`serve.py` must NOT depend on it.**

**Plan (agreed direction):** the user chose the **local server** approach. `serve.py` already
exists and serves the dashboard + cohorts at http://127.0.0.1:5000 with endpoints
`/api/live`, `/api/schedule`, `/api/photo`, `/api/_debug` (caching, CORS, 302-redirect for
photos). It currently calls python-espncricinfo (broken) — **rewrite its data layer to drive
ESPNcricinfo's consumer JSON API via Playwright** (which DOES work for the user — the ICC
script uses it). Endpoints to navigate to and read `document.body.innerText` as JSON:
  - live:   `https://hs-consumer-api.espncricinfo.com/v1/pages/matches/live?lang=en&latest=true`
  - player: `https://hs-consumer-api.espncricinfo.com/v1/pages/player/home?playerId=<id>&lang=en`
  - schedule: needs confirming — try `.../v1/pages/matches/current?lang=en` or a fixtures/day endpoint.
**NEXT STEP**: write `scripts/probe_espn_api.py` (Playwright Chromium → goto each URL →
print the JSON) and have the user run it + paste output. Then map fields into
`serve.py`'s `_fmt_match` / `_fmt_sched` / `resolve_photo` and confirm Akamai lets the
browser through. Playwright sync in a threaded HTTP server is fiddly — use a **single-threaded
HTTPServer** (serialize requests) or a dedicated Playwright worker thread + queue; keep one
persistent browser; rely on caching (live ~25s, schedule ~60s, photos cached to `.cache/`).

### C. Reminder: user opened the FILE for the live tab
The "You're currently opening the file directly" message = they double-clicked
`index.html` (file://). For live data they must open **http://127.0.0.1:5000** while
`python serve.py` is running. Core analytics work either way.

### D. Housekeeping when committing
Add `.cache/` to `.gitignore` (created by serve.py for photo cache) before pushing.

## Quick map of key files
- `build_all.py` — one-command build (ingest + analytics).
- `packages/etl/cil_etl/{store,parse,ingest_zip}.py` — schema, parse, streaming ingest.
- `packages/analytics/cil_analytics/pipeline.py` — cohorts + all metrics + bundle output.
- `web/dashboard/index.html` — the whole dashboard (HTML+CSS+JS, single file).
- `web/dashboard/cohorts/*.js`, `index.js` — generated data (lazy-loaded).
- `serve.py` — local app server (live/schedule/photo) — NEEDS the Playwright rewrite (issue B).
- `scripts/enrich_players_cricinfo.py` — WORKS (player meta + Cricinfo links).
- `scripts/fetch_icc_rankings.py` — fixed this session, needs re-test (issue A).
- `scripts/probe_cricinfo.py` — showed python-espncricinfo is broken (issue B).
- `scripts/README.md` — run instructions for all scripts.
