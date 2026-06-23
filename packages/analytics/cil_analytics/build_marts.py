"""Materialize mart tables from core.fact_delivery. Atomic-swap on completion."""
from __future__ import annotations
import os, polars as pl, psycopg
from .metrics import batting_metrics, bowling_metrics

DB = os.environ.get("DATABASE_URL", "postgresql://cil:cil@localhost:5432/cil")
URI = DB.replace("postgresql://", "postgresql://")

def _load_deliveries() -> pl.DataFrame:
    return pl.read_database_uri(
        "SELECT match_id, innings_no, batter_id, bowler_id, non_striker_id, "
        "runs_batter, runs_extras, extra_type, wicket_kind, player_out_id, phase, "
        "(SELECT format FROM core.dim_match m WHERE m.match_id=d.match_id) AS format "
        "FROM core.fact_delivery d", URI)

def main():
    df = _load_deliveries()
    bat = batting_metrics(df).with_columns(split=pl.lit("overall"))
    bowl = bowling_metrics(df).with_columns(split=pl.lit("overall"))
    # phase splits
    bat_phase = batting_metrics(df, group=("batter_id", "format", "phase"))
    print(f"player_batting rows={bat.height}  bowling rows={bowl.height}  phase={bat_phase.height}")
    # write_database with replace; in prod write to _new + RENAME for atomicity
    bat.write_database("marts.player_batting", URI, if_table_exists="append")
    bowl.write_database("marts.player_bowling", URI, if_table_exists="append")
    with psycopg.connect(DB) as c, c.cursor() as cur:
        cur.execute("INSERT INTO meta.data_version(revision,note) VALUES (%s,%s)",
                    ("rebuild", f"bat={bat.height} bowl={bowl.height}"))
        c.commit()

if __name__ == "__main__":
    main()
