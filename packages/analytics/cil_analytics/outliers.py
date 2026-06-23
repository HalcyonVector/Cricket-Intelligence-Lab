"""Outlier detection: studentized residuals from a robust y~x fit."""
from __future__ import annotations
import numpy as np
from scipy import stats

def residual_outliers(x, y, z_thresh: float = 3.0):
    x = np.asarray(x, float); y = np.asarray(y, float)
    m = np.isfinite(x) & np.isfinite(y)
    x, y = x[m], y[m]
    slope, intercept, *_ = stats.linregress(x, y)
    resid = y - (slope * x + intercept)
    z = (resid - resid.mean()) / (resid.std() + 1e-9)
    return z, np.abs(z) > z_thresh
