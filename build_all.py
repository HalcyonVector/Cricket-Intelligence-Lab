#!/usr/bin/env python3
"""One-command build: Cricsheet zip -> SQLite -> per-cohort dashboard bundles.

    python build_all.py --zip all_json.zip

Steps:
  1. Stream-ingest EVERY match in the zip into cil.db, classified correctly by
     team_type (international vs club) and normalized format (t20/odi/test).
  2. Compute all cohorts and write:
       web/data/<key>.json            (full bundles, for the API)
       web/dashboard/cohorts/<key>.js (lazy-loaded bundles for the dashboard)
       web/dashboard/index.js         (cohort metadata -> instant boot)

Then open web/dashboard/index.html in a browser.
"""
from __future__ import annotations
import argparse, os, sys, glob

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "packages", "etl"))
sys.path.insert(0, os.path.join(ROOT, "packages", "analytics"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", default=None, help="path to Cricsheet zip (default: first *.zip found)")
    ap.add_argument("--db", default=os.path.join(ROOT, "cil.db"))
    ap.add_argument("--outdir", default=os.path.join(ROOT, "web", "data"))
    ap.add_argument("--jsdir", default=os.path.join(ROOT, "web", "dashboard", "cohorts"))
    ap.add_argument("--skip-ingest", action="store_true", help="reuse existing cil.db")
    a = ap.parse_args()

    if not a.skip_ingest:
        zip_path = a.zip
        if not zip_path:
            cands = glob.glob(os.path.join(ROOT, "*.zip")) + glob.glob("*.zip")
            if not cands:
                sys.exit("No zip found. Pass --zip path/to/all_json.zip")
            zip_path = cands[0]
        print(f"[1/2] Ingesting {os.path.basename(zip_path)} (all matches, streaming)...")
        from cil_etl.ingest_zip import ingest_zip
        info = ingest_zip(zip_path, a.db)
        print(f"      matches={info['matches']:,}  deliveries={info['deliveries']:,}  "
              f"skipped={info['skipped']}  ({info['secs']}s)")
    else:
        print("[1/2] Skipping ingest (reusing existing cil.db)")

    print("[2/2] Building per-cohort bundles...")
    from cil_analytics.pipeline import build
    index = build(a.db, a.outdir, a.jsdir)
    print(f"\nDone. {len(index['cohorts'])} cohorts. Open web/dashboard/index.html in your browser.")


if __name__ == "__main__":
    main()
