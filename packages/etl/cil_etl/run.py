"""Ingest Cricsheet zip(s) / dir of JSON into SQLite. Idempotent per match_id.

Usage:
    python -m cil_etl.run --src "<folder containing .zip or .json>" --db cil.db
"""
from __future__ import annotations
import argparse, glob, os, tempfile, zipfile

from .parse import parse_match
from .store import connect, reset


def _registry_names(path: str) -> dict:
    import orjson
    raw = orjson.loads(open(path, "rb").read())
    return raw.get("info", {}).get("registry", {}).get("people", {})


def ingest(src: str, db: str = "cil.db", fmt_filter: str | None = None, limit: int | None = None) -> dict:
    conn = connect(db)
    reset(conn)

    # collect json files (unzip any zips into a temp dir)
    tmp = tempfile.mkdtemp(prefix="cil_")
    json_files: list[str] = []
    for zp in sorted(glob.glob(os.path.join(src, "**", "*.zip"), recursive=True)):
        with zipfile.ZipFile(zp) as z:
            z.extractall(tmp)
    json_files += glob.glob(os.path.join(tmp, "**", "*.json"), recursive=True)
    json_files += glob.glob(os.path.join(src, "**", "*.json"), recursive=True)
    json_files = [p for p in sorted(set(json_files)) if not p.endswith(("_info.json", "README.json"))]

    n_matches = n_deliveries = n_skipped = 0
    players: dict[str, str] = {}

    for path in json_files:
        try:
            m = parse_match(path)
        except Exception:
            n_skipped += 1
            continue
        if fmt_filter and m.fmt != fmt_filter:
            continue
        for name, pid in _registry_names(path).items():
            players[pid] = name

        won = m.winner
        conn.execute(
            "INSERT OR REPLACE INTO dim_match VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (m.match_id, m.fmt, m.gender, m.league, m.date, m.venue, m.city,
             (m.teams + [None, None])[0], (m.teams + [None, None])[1],
             m.toss_winner, m.toss_decision, m.winner, m.result_type, m.stage, int(m.is_knockout)))
        for inn_no, runs in m.innings_runs.items():
            bt = next((d.batting_team for d in m.deliveries if d.innings_no == inn_no), None)
            conn.execute("INSERT INTO fact_innings VALUES (?,?,?,?)", (m.match_id, inn_no, bt, runs))

        rows = []
        for d in m.deliveries:
            is_win = 1 if (won and d.batting_team == won) else (0 if won else None)
            is_chase = 1 if d.innings_no >= 2 else 0
            rows.append((m.match_id, d.innings_no, d.over_no, d.ball_in_over,
                         d.batter_id, d.non_striker_id, d.bowler_id,
                         d.runs_batter, d.runs_extras, d.extra_type, d.wicket_kind,
                         d.player_out_id, d.phase, d.batting_team, d.bowling_team,
                         d.target, d.runs_required, d.balls_remaining,
                         is_win, is_chase, int(m.is_knockout)))
        conn.executemany("INSERT INTO fact_delivery VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        n_matches += 1
        n_deliveries += len(rows)
        if n_matches % 200 == 0:
            conn.commit()
        if limit and n_matches >= limit:
            break

    for pid, name in players.items():
        conn.execute("INSERT OR REPLACE INTO dim_player(player_id, name) VALUES (?,?)", (pid, name))
    conn.commit()
    conn.close()
    return {"matches": n_matches, "deliveries": n_deliveries, "players": len(players), "skipped": n_skipped}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--db", default="cil.db")
    ap.add_argument("--format", default=None)
    ap.add_argument("--limit", type=int, default=None)
    a = ap.parse_args()
    print(ingest(a.src, a.db, a.format, a.limit))
