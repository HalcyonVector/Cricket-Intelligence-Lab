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
import argparse, os, sys, glob, sqlite3, subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "packages", "etl"))
sys.path.insert(0, os.path.join(ROOT, "packages", "analytics"))


LOCK = os.path.join(ROOT, ".build.lock")


def _finalize_db(path):
    """Checkpoint the WAL into a single clean file so the atomic replace yields a valid db."""
    con = sqlite3.connect(path)
    con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    con.execute("PRAGMA journal_mode=DELETE")
    con.close()
    for ext in ("-wal", "-shm"):
        p = path + ext
        if os.path.exists(p):
            try:
                os.remove(p)
            except OSError:
                pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", default=None, help="path to Cricsheet zip (default: first *.zip found)")
    ap.add_argument("--db", default=os.path.join(ROOT, "cil.db"))
    ap.add_argument("--outdir", default=os.path.join(ROOT, "web", "data"))
    ap.add_argument("--jsdir", default=os.path.join(ROOT, "web", "dashboard", "cohorts"))
    ap.add_argument("--skip-ingest", action="store_true", help="reuse existing cil.db")
    a = ap.parse_args()

    if os.path.exists(LOCK):
        sys.exit(f"A build lock exists ({LOCK}). Another build may be running; if not, delete it and retry.")
    open(LOCK, "w").write(str(os.getpid()))  # serve.py refuses to open cil.db while this exists
    try:
        if not a.skip_ingest:
            zip_path = a.zip
            if not zip_path:
                cands = glob.glob(os.path.join(ROOT, "*.zip")) + glob.glob("*.zip")
                if not cands:
                    sys.exit("No zip found. Pass --zip path/to/all_json.zip")
                zip_path = cands[0]
            tmp = a.db + ".building"
            for ext in ("", "-wal", "-shm"):
                if os.path.exists(tmp + ext):
                    os.remove(tmp + ext)
            print(f"[1/3] Ingesting {os.path.basename(zip_path)} -> {os.path.basename(tmp)} (atomic)...")
            from cil_etl.ingest_zip import ingest_zip
            info = ingest_zip(zip_path, tmp)
            _finalize_db(tmp)
            os.replace(tmp, a.db)  # atomic swap; readers see old or new db, never a half-write
            print(f"      matches={info['matches']:,}  deliveries={info['deliveries']:,}  "
                  f"skipped={info['skipped']}  ({info['secs']}s)")
            if os.path.isdir(a.outdir):
                for fn in os.listdir(a.outdir):
                    if fn.endswith(".json"):
                        os.remove(os.path.join(a.outdir, fn))
        else:
            print("[1/3] Skipping ingest (reusing existing cil.db)")

        print("[2/3] Building per-cohort bundles (atomic per-file writes)...")
        from cil_analytics.pipeline import build
        index = build(a.db, a.outdir, a.jsdir)
    finally:
        if os.path.exists(LOCK):
            os.remove(LOCK)

    print("[3/3] Verifying build...")
    vp = os.path.join(ROOT, "verify_build.py")
    if os.path.exists(vp):
        rc = subprocess.call([sys.executable, vp])
        if rc != 0:
            sys.exit(f"\n!! verify_build.py found problems (exit {rc}) - build is NOT clean.")
    print(f"\nDone. {len(index['cohorts'])} cohorts, verified. Open web/dashboard/index.html in your browser.")


if __name__ == "__main__":
    main()
