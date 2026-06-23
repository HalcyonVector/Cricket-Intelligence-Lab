"""SQLite store for the zero-setup engine. Mirrors the Postgres star schema with
flat (no-namespace) table names. Used by the in-process demo pipeline and the API.
"""
from __future__ import annotations
import sqlite3

DDL = """
CREATE TABLE IF NOT EXISTS dim_player (
  player_id TEXT PRIMARY KEY, name TEXT NOT NULL,
  batting_hand TEXT, bowling_type TEXT
);
CREATE TABLE IF NOT EXISTS dim_match (
  match_id TEXT PRIMARY KEY, format TEXT, team_type TEXT, gender TEXT, league TEXT,
  match_date TEXT, venue TEXT, city TEXT,
  team_a TEXT, team_b TEXT, toss_winner TEXT, toss_decision TEXT,
  winner TEXT, result_type TEXT, stage TEXT, is_knockout INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS fact_delivery (
  match_id TEXT, innings_no INTEGER, over_no INTEGER, ball_in_over INTEGER,
  batter_id TEXT, non_striker_id TEXT, bowler_id TEXT,
  runs_batter INTEGER, runs_extras INTEGER, extra_type TEXT,
  wicket_kind TEXT, player_out_id TEXT, phase TEXT,
  batting_team TEXT, bowling_team TEXT,
  target INTEGER, runs_required INTEGER, balls_remaining INTEGER,
  is_win INTEGER, is_chase INTEGER, is_knockout INTEGER
);
CREATE TABLE IF NOT EXISTS fact_innings (
  match_id TEXT, innings_no INTEGER, batting_team TEXT, runs INTEGER
);
CREATE INDEX IF NOT EXISTS ix_fd_batter ON fact_delivery(batter_id);
CREATE INDEX IF NOT EXISTS ix_fd_bowler ON fact_delivery(bowler_id);
CREATE INDEX IF NOT EXISTS ix_fd_pair   ON fact_delivery(batter_id, bowler_id);
"""


def connect(path: str = "cil.db") -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(DDL)
    return conn


def reset(conn: sqlite3.Connection):
    for t in ("fact_delivery", "fact_innings", "dim_match", "dim_player"):
        conn.execute(f"DELETE FROM {t}")
    conn.commit()
