"""Idempotent load of parsed deliveries into raw + core. Keyed by match_id."""
from __future__ import annotations
import os, glob, orjson
import psycopg
from .parse import parse_match

DB = os.environ.get("DATABASE_URL", "postgresql://cil:cil@localhost:5432/cil")


def _upsert_players(cur, info):
    for name, pid in info.get("registry", {}).get("people", {}).items():
        cur.execute(
            "INSERT INTO core.dim_player(player_id,name) VALUES (%s,%s) "
            "ON CONFLICT (player_id) DO NOTHING", (pid, name))


def load_match(cur, path: str):
    info, rows = parse_match(path)
    match_id = path.rsplit("/", 1)[-1].split(".")[0]
    # idempotency: clear prior rows for this match, then reinsert
    cur.execute("DELETE FROM core.fact_delivery WHERE match_id=%s", (match_id,))
    _upsert_players(cur, info)
    cur.execute(
        "INSERT INTO core.dim_match(match_id,format,gender,match_date) VALUES (%s,%s,%s,%s) "
        "ON CONFLICT (match_id) DO UPDATE SET format=EXCLUDED.format",
        (match_id, (info.get("match_type") or "").lower(), info.get("gender"),
         (info.get("dates") or [None])[0]))
    with cur.copy(
        "COPY core.fact_delivery(match_id,innings_no,over_no,ball_in_over,batter_id,"
        "non_striker_id,bowler_id,runs_batter,runs_extras,extra_type,wicket_kind,"
        "player_out_id,phase,is_powerplay) FROM STDIN") as cp:
        for r in rows:
            cp.write_row((r.match_id, r.innings_no, r.over_no, r.ball_in_over, r.batter_id,
                          r.non_striker_id, r.bowler_id, r.runs_batter, r.runs_extras,
                          r.extra_type, r.wicket_kind, r.player_out_id, r.phase, r.is_powerplay))
    cur.execute("INSERT INTO meta.ingest_log(match_id,source_file,status) VALUES (%s,%s,'ok') "
                "ON CONFLICT (match_id) DO UPDATE SET ingested_at=now(),status='ok'",
                (match_id, path))
    return len(rows)


def ingest_dir(src: str) -> int:
    total = 0
    with psycopg.connect(DB) as conn, conn.cursor() as cur:
        for path in sorted(glob.glob(os.path.join(src, "*.json"))):
            if path.endswith("_info.json"):
                continue
            total += load_match(cur, path)
            conn.commit()
    return total
