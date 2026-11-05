"""Win-probability models for limited-overs cricket, trained on the whole ball-by-ball history.

Two small logistic regressions per format and gender:
  inn1  P(batting-first side wins | runs, balls bowled, wickets lost)
  inn2  P(chasing side wins       | runs needed, balls left, wickets lost)
States are taken at the end of every over. The coefficients go to web/dashboard/winprob.js,
where the dashboard evaluates the same features (keep features() in sync with features.js).
"""
from __future__ import annotations
import json, math, zlib
from collections import defaultdict
import numpy as np

BALLS = {"t20": 120, "odi": 300}
WK = ("wicket_kind IS NOT NULL AND wicket_kind NOT IN ('retired hurt','retired not out')")
LEGAL = "(extra_type IS NULL OR extra_type IN ('byes','legbyes'))"


def features(inn, runs, balls, wkts, T, target=None):
    """Feature vector for one state. Mirrors winFeatures() in web/dashboard/features.js."""
    frac = min(balls, T) / T
    wl = min(wkts, 10) / 10
    if inn == 1:
        s = runs / (T * 1.25)                       # runs relative to a format-sized par
        return [1.0, s, frac, wl, s * (1 - frac), wl * (1 - frac), frac * frac]
    need = max(target - runs, 0)
    left = max(T - balls, 1)
    rrr = min(need * 6 / left, 36) / 10
    return [1.0, rrr, wl, left / T, math.log1p(need) / 5, (1 - wl) * left / T, rrr * wl]


def _fit(X, y, l2=1e-3, iters=30):
    """Logistic regression by Newton/IRLS with a light ridge penalty."""
    X = np.asarray(X, float); y = np.asarray(y, float)
    w = np.zeros(X.shape[1])
    for _ in range(iters):
        p = 1 / (1 + np.exp(-np.clip(X @ w, -30, 30)))
        g = X.T @ (p - y) + l2 * w
        H = (X * (p * (1 - p))[:, None]).T @ X + l2 * np.eye(len(w))
        step = np.linalg.solve(H, g)
        w -= step
        if np.abs(step).max() < 1e-7:
            break
    return w


def _states(conn, fmt, gender):
    """End-of-over states for decided matches: (match_id, inn, runs, balls, wkts, target, won)."""
    T = BALLS[fmt]
    rows = conn.execute(f"""SELECT d.match_id, d.innings_no, d.over_no,
            SUM(d.runs_batter + d.runs_extras), SUM(CASE WHEN {WK} THEN 1 ELSE 0 END),
            SUM(CASE WHEN {LEGAL} THEN 1 ELSE 0 END), MAX(d.batting_team), MAX(m.winner)
        FROM fact_delivery d JOIN dim_match m ON m.match_id = d.match_id
        WHERE m.format = ? AND m.gender = ? AND d.innings_no IN (1, 2) AND m.winner IS NOT NULL
        GROUP BY d.match_id, d.innings_no, d.over_no ORDER BY d.match_id, d.innings_no, d.over_no""",
        (fmt, gender)).fetchall()
    by = defaultdict(lambda: {1: [], 2: []})
    for mid, inn, _o, r, w, b, bt, win in rows:
        by[mid][inn].append((r or 0, w or 0, b or 0, bt, win))
    out = []
    for mid, inns in by.items():
        if not inns[1] or not inns[2]:
            continue
        tot1 = sum(x[0] for x in inns[1]); target = tot1 + 1
        if sum(x[2] for x in inns[1]) < T * 0.9 and sum(x[1] for x in inns[1]) < 10:
            continue  # shortened first innings (rain): the target isn't the plain total
        for inn in (1, 2):
            runs = wk = balls = 0
            for r, w, b, bt, win in inns[inn]:
                runs += r; wk += w; balls += b
                if balls >= T or wk >= 10:
                    break
                out.append((mid, inn, runs, balls, wk, target if inn == 2 else None, 1 if win == bt else 0))
    return out


def train(conn):
    models = {}
    for fmt, T in BALLS.items():
        for gender in ("male", "female"):
            st = _states(conn, fmt, gender)
            n_matches = len({s[0] for s in st})
            if n_matches < 150:
                continue
            m = {"T": T, "matches": n_matches}
            for inn in (1, 2):
                rows = [s for s in st if s[1] == inn]
                X = [features(inn, s[2], s[3], s[4], T, s[5]) for s in rows]
                y = [s[6] for s in rows]
                test = np.array([zlib.crc32(str(s[0]).encode()) % 5 == 0 for s in rows])  # 20% of matches held out
                Xa, ya = np.asarray(X), np.asarray(y)
                w = _fit(Xa[~test], ya[~test])
                p = 1 / (1 + np.exp(-np.clip(Xa[test] @ w, -30, 30)))
                brier = float(np.mean((p - ya[test]) ** 2)) if test.any() else None
                w = _fit(Xa, ya)  # final fit on everything
                m[f"inn{inn}"] = [round(float(v), 5) for v in w]
                m[f"brier{inn}"] = round(brier, 4) if brier is not None else None
            models[f"{fmt}_{gender}"] = m
            print(f"  winprob {fmt}_{gender}: {n_matches} matches, held-out Brier inn1 {m['brier1']} inn2 {m['brier2']}")
    return models


def write(path, models, write_fn):
    write_fn(path, "window.CIL_WINPROB=" + json.dumps({"version": 1, "models": models}, separators=(",", ":")) + ";\n")
