"""Cohort statistics: percentiles, z-scores, empirical-Bayes shrinkage."""
from __future__ import annotations
import numpy as np
import polars as pl
from scipy import stats

def percentiles(df: pl.DataFrame, metric: str, min_n: int = 0, n_col: str = "balls") -> pl.DataFrame:
    d = df.filter(pl.col(n_col) >= min_n)
    x = d[metric].to_numpy().astype(float)
    if len(x) < 2:
        return d.with_columns(percentile=pl.lit(None), zscore=pl.lit(None))
    pct = stats.rankdata(x, method="average") / len(x) * 100
    z = (x - np.nanmean(x)) / (np.nanstd(x) + 1e-9)
    return d.with_columns(percentile=pl.Series(pct).round(1), zscore=pl.Series(z).round(2))

def shrink(value, n, prior_mean, k=50.0):
    """Empirical-Bayes: pull ratio metrics toward the cohort mean at low n."""
    return (n * value + k * prior_mean) / (n + k)
