"""Zero-DB FastAPI: serves the computed per-cohort JSON bundles directly.

No Postgres required. Reads web/data/*.json produced by build_all.py and exposes
the same shapes the dashboard uses. Great for local dev and demos.

    pip install fastapi uvicorn
    uvicorn app.local_api:app --app-dir services/api --reload
"""
from __future__ import annotations
import json, os, glob
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
DATA = os.path.join(ROOT, "web", "data")

app = FastAPI(title="Cricket Intelligence Lab — Local API", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_cache: dict[str, dict] = {}


def cohort(key: str) -> dict:
    if key not in _cache:
        path = os.path.join(DATA, f"{key}.json")
        if not os.path.exists(path):
            raise HTTPException(404, f"cohort '{key}' not built. Run build_all.py.")
        _cache[key] = json.load(open(path))
    return _cache[key]


@app.get("/health")
def health():
    return {"status": "ok", "data_dir": DATA}


@app.get("/v1/cohorts")
def cohorts():
    out = []
    for f in glob.glob(os.path.join(DATA, "*.json")):
        k = os.path.splitext(os.path.basename(f))[0]
        if k == "index":
            continue
        out.append(cohort(k)["meta"])
    return {"data": out}


@app.get("/v1/{ck}/players")
def players(ck: str, q: str = Query("", min_length=0), limit: int = 50):
    ps = cohort(ck)["players"]
    rows = [{"pid": pid, "name": p["name"], "archetype": p.get("archetype"),
             "runs": p["runs"], "avg": p["avg"], "sr": p["sr"]}
            for pid, p in ps.items() if q.lower() in p["name"].lower()]
    rows.sort(key=lambda r: r["runs"], reverse=True)
    return {"data": rows[:limit], "meta": {"count": len(rows)}}


@app.get("/v1/{ck}/players/{pid}")
def player(ck: str, pid: str):
    ps = cohort(ck)["players"]
    if pid not in ps:
        raise HTTPException(404, "player not found / not qualified in cohort")
    p = ps[pid]
    return {"data": p, "meta": {"cohort": ck, "low_confidence": p["balls"] < cohort(ck)["meta"]["qual_balls"] * 1.5}}


@app.get("/v1/{ck}/matchups")
def matchups(ck: str, batter: str | None = None, limit: int = 100):
    mus = cohort(ck)["matchups_top"]
    if batter:
        mus = [m for m in mus if m["batter"] == batter]
    return {"data": mus[:limit]}


@app.get("/v1/{ck}/outliers")
def outliers(ck: str, pair: str = "avg_vs_sr"):
    o = cohort(ck)["outliers"].get(pair)
    if not o:
        raise HTTPException(404, "unknown pair")
    return {"data": o, "meta": {"flagged": sum(1 for p in o["points"] if p["flag"])}}


@app.get("/v1/{ck}/records")
def records(ck: str):
    return {"data": cohort(ck)["records"]}


@app.get("/v1/{ck}/venues")
def venues(ck: str):
    return {"data": cohort(ck)["venues"]}
