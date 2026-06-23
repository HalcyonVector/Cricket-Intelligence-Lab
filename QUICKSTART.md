# Cricket Intelligence Lab — Quickstart

You already have the data: **`all_json.zip`** (the full Cricsheet corpus) sits in this folder.
Two ways to run. The first gives you a live, interactive dashboard on **real data** in ~2 minutes.

---

## Option A — Static dashboard on real data (recommended, zero infra)

Requires Python 3.10+.

```bash
# 1. install the three build deps
pip install orjson polars numpy

# 2. one command: zip -> SQLite -> marts -> dashboard data
python build_all.py --zip all_json.zip

# 3. open the dashboard
#    web/dashboard/index.html   (just double-click it)
```

What `build_all.py` does:

1. **Streams** matches straight out of the zip (never extracts — safe on any disk) and
   filters to four clean cohorts: **IPL, men's T20I, men's ODI, men's Test**.
2. Loads them into `cil.db` (SQLite) via the real ETL parser.
3. Computes every mart (batting overall/phase/context, bowling, matchups, venues,
   percentiles, similarity, archetypes, outliers, records).
4. Writes `web/dashboard/data.js`, which the dashboard reads offline.

Expected: ~8,000 matches, several million deliveries, ~1–2 min on a laptop.

> Want all leagues (BBL, PSL, …) or women's cricket too? Edit `in_cohort()` and the
> `COHORTS` list in `packages/analytics/cil_analytics/pipeline.py`, then re-run.

### If Python reports "source code string cannot contain null bytes"
A couple of files were written through a sandbox mount that can append stray trailing
NUL bytes. Fix them all in one shot:

```bash
python fix_nulls.py
```

---

## Option B — Full production stack (Postgres + FastAPI + Next.js)

Requires Docker.

```bash
docker compose -f infra/docker-compose.full.yml up --build
# Postgres :5432   API :8000 (/docs)   Web :3000
```

This brings up the production scaffold. The API also has a **zero-DB local mode** that
serves the computed JSON bundles directly (no Postgres needed):

```bash
pip install fastapi uvicorn
uvicorn app.local_api:app --app-dir services/api --reload   # serves web/data/*.json at :8000
```

Open http://localhost:8000/docs for the API, and run the Next.js app:

```bash
cd apps/web && npm install && npm run dev      # http://localhost:3000
```

---

## What's where

| Path | What |
|------|------|
| `build_all.py` | one-command pipeline (zip → dashboard data) |
| `web/dashboard/index.html` | the interactive dashboard (opens offline) |
| `packages/etl/cil_etl/` | Cricsheet parser, streaming zip ingest, SQLite store |
| `packages/analytics/cil_analytics/pipeline.py` | all marts + per-cohort bundles |
| `services/api/` | FastAPI (Postgres prod + `local_api` zero-DB mode) |
| `apps/web/` | Next.js production frontend |
| `db/schema/` | Postgres star schema (raw / core / marts) |
| `docs/` | full design spec (.docx) + ADRs |

Data: open **Cricsheet** (https://cricsheet.org) — ODbL / CC BY-SA. Attribution required.
