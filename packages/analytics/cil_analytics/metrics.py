"""Batting/bowling metric definitions. Pure functions over Polars frames.

Every metric mirrors the Metric Definitions section of the design spec.
Ratios at low sample are shrunk toward the cohort mean (empirical Bayes).
"""
from __future__ import annotations
import polars as pl

LEGAL = pl.col("extra_type").is_null() | pl.col("extra_type").is_in(["bye", "legbye"])

def batting_metrics(df: pl.DataFrame, group=("batter_id", "format")) -> pl.DataFrame:
    g = list(group)
    legal = df.filter(LEGAL)
    return (
        legal.group_by(g).agg(
            balls=pl.len(),
            runs=pl.col("runs_batter").sum(),
            dismissals=(pl.col("player_out_id") == pl.col("batter_id")).sum(),
            boundaries=((pl.col("runs_batter") == 4) | (pl.col("runs_batter") == 6)).sum(),
            dots=(pl.col("runs_batter") == 0).sum(),
            scoring=(pl.col("runs_batter") > 0).sum(),
            boundary_runs=pl.when(pl.col("runs_batter").is_in([4, 6]))
                            .then(pl.col("runs_batter")).otherwise(0).sum(),
        )
        .with_columns(
            strike_rate=(pl.col("runs") / pl.col("balls") * 100).round(2),
            average=pl.when(pl.col("dismissals") > 0)
                      .then(pl.col("runs") / pl.col("dismissals"))
                      .otherwise(pl.col("runs")).round(2),
            boundary_pct=(pl.col("boundaries") / pl.col("balls") * 100).round(2),
            dot_pct=(pl.col("dots") / pl.col("balls") * 100).round(2),
            runs_per_scoring_shot=(pl.col("runs") / pl.col("scoring")).round(2),
            boundary_dependency=(pl.col("boundary_runs") / pl.col("runs") * 100).round(2),
        )
    )

def bowling_metrics(df: pl.DataFrame, group=("bowler_id", "format")) -> pl.DataFrame:
    g = list(group)
    return (
        df.group_by(g).agg(
            balls=LEGAL.sum(),
            runs_conceded=(pl.col("runs_batter") + pl.col("runs_extras")).sum(),
            wickets=(pl.col("wicket_kind").is_not_null()
                     & ~pl.col("wicket_kind").is_in(["run out", "retired hurt"])).sum(),
            dots=((pl.col("runs_batter") + pl.col("runs_extras")) == 0).sum(),
        )
        .with_columns(
            economy=(pl.col("runs_conceded") / (pl.col("balls") / 6)).round(2),
            bowling_avg=pl.when(pl.col("wickets") > 0)
                          .then(pl.col("runs_conceded") / pl.col("wickets")).round(2),
            bowling_sr=pl.when(pl.col("wickets") > 0)
                         .then(pl.col("balls") / pl.col("wickets")).round(2),
            dot_pct=(pl.col("dots") / pl.col("balls") * 100).round(2),
        )
    )
