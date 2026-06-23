"""Compute all marts from the SQLite store and export per-cohort bundles.

Cohorts:
  * 6 FIXED international cohorts keyed on team_type='international' + format + gender
    (Men's/Women's T20I, ODI, Test). T20I = Cricsheet T20 *and* IT20 internationals.
  * Auto-discovered CLUB league cohorts (IPL, BBL, PSL, County Championship, ...)
    keyed on team_type='club' + canonical league name.

Thresholds:
  * Counting-stat lists & the player table include EVERYONE (>=1 ball). The UI paginates.
  * Only rate-stat leaderboards (avg / SR / economy / etc.) apply a light, format-aware
    floor so 2-ball wonders don't top the charts. Percentiles & archetypes use that set.

Output per cohort:
  * web/data/<key>.json                 (full bundle, also served by the API)
  * web/dashboard/cohorts/<key>.js      (same bundle wrapped for lazy <script> loading)
  * web/dashboard/index.js              (cohort metadata only -> instant boot)
"""
from __future__ import annotations
import argparse, json, os, re, sqlite3, time, math
from collections import defaultdict
import numpy as np

LEGAL = "(extra_type IS NULL OR extra_type IN ('byes','legbyes'))"
RPO = {"t20": 8.0, "odi": 5.5, "test": 3.3}
# Light rate-stat floors (balls). Counting stats are NOT filtered.
RATE_MIN_BAT = {"t20": 60, "odi": 150, "test": 300}
RATE_MIN_BOWL = {"t20": 60, "odi": 120, "test": 300}
LIST_CAP = 500   # max rows per leaderboard (paginated 15/page in the UI)

FIXED = [
    {"key": "t20i_men",   "label": "Men's T20 Internationals",   "format": "t20",  "gender": "male",   "intl": True},
    {"key": "odi_men",    "label": "Men's ODIs",                 "format": "odi",  "gender": "male",   "intl": True},
    {"key": "test_men",   "label": "Men's Tests",                "format": "test", "gender": "male",   "intl": True},
    {"key": "t20i_women", "label": "Women's T20 Internationals", "format": "t20",  "gender": "female", "intl": True},
    {"key": "odi_women",  "label": "Women's ODIs",               "format": "odi",  "gender": "female", "intl": True},
    {"key": "test_women", "label": "Women's Tests",              "format": "test", "gender": "female", "intl": True},
]
LEAGUE_MIN = {"male": 25, "female": 20}


def _rows(conn, sql, params=()):
    cur = conn.execute(sql, params)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def slug(s):
    return re.sub(r"[^a-z0-9]+", "_", (s or "").lower()).strip("_")[:46]


def discover_league_cohorts(conn):
    out = []
    for r in _rows(conn, """SELECT league, gender, format, COUNT(DISTINCT match_id) c
                            FROM dim_match
                            WHERE team_type='club' AND league IS NOT NULL
                            GROUP BY league, gender ORDER BY c DESC"""):
        # one row per (league,gender,format); collapse to dominant format below
        out.append(r)
    # collapse to (league,gender): keep dominant format, sum matches
    agg = {}
    for r in out:
        k = (r["league"], r["gender"])
        a = agg.setdefault(k, {"matches": 0, "fmt": r["format"], "fmtc": 0})
        a["matches"] += r["c"]
        if r["c"] > a["fmtc"]:
            a["fmtc"] = r["c"]; a["fmt"] = r["format"]
    specs = []
    for (league, gender), a in sorted(agg.items(), key=lambda x: -x[1]["matches"]):
        if a["matches"] < LEAGUE_MIN.get(gender, 25):
            continue
        g = "Women's " if gender == "female" else ""
        label = league if (gender == "male" or league.lower().startswith("women")) else f"{g}{league}"
        specs.append({"key": slug(("w_" if gender == "female" else "") + league),
                      "label": label, "format": a["fmt"], "gender": gender,
                      "league_like": league, "intl": False})
    return specs


def make_scope(conn, spec):
    conn.execute("DROP TABLE IF EXISTS sd")
    where, params = ["m.format=?"], [spec["format"]]
    if spec.get("gender"):
        where.append("m.gender=?"); params.append(spec["gender"])
    if spec.get("intl"):
        where.append("m.team_type='international'")
    if spec.get("league_like"):
        where.append("m.team_type='club'")
        where.append("m.league=?"); params.append(spec["league_like"])
    conn.execute(f"""CREATE TEMP TABLE sd AS SELECT d.*, substr(m.match_date,1,4) AS yr,
        m.venue AS venue, m.city AS city FROM fact_delivery d
        JOIN dim_match m ON m.match_id=d.match_id WHERE {' AND '.join(where)}""", params)
    conn.execute("CREATE INDEX ix_sd_bat ON sd(batter_id)")
    conn.execute("CREATE INDEX ix_sd_bowl ON sd(bowler_id)")
    conn.execute("DROP TABLE IF EXISTS sm")
    conn.execute("CREATE TEMP TABLE sm AS SELECT DISTINCT match_id FROM sd")
    conn.execute("CREATE INDEX ix_sm ON sm(match_id)")
    conn.execute("DROP TABLE IF EXISTS bf")
    conn.execute("""CREATE TEMP TABLE bf AS SELECT i.match_id, i.batting_team
        FROM fact_innings i JOIN sm ON sm.match_id=i.match_id WHERE i.innings_no=1""")
    conn.execute("CREATE INDEX ix_bf ON bf(match_id)")
    n = conn.execute("SELECT COUNT(*) FROM sd").fetchone()[0]
    cov = conn.execute("""SELECT MIN(match_date), MAX(match_date), COUNT(*)
        FROM dim_match m JOIN sm ON sm.match_id=m.match_id""").fetchone()
    return n, cov


def batting_table(conn, extra="", params=()):
    sql = f"""SELECT batter_id pid, COUNT(*) balls, SUM(runs_batter) runs,
        SUM(CASE WHEN runs_batter IN (4,6) THEN 1 ELSE 0 END) boundaries,
        SUM(CASE WHEN runs_batter=6 THEN 1 ELSE 0 END) sixes,
        SUM(CASE WHEN runs_batter=0 THEN 1 ELSE 0 END) dots,
        SUM(CASE WHEN runs_batter>0 THEN 1 ELSE 0 END) scoring,
        SUM(CASE WHEN runs_batter=1 THEN 1 ELSE 0 END) ones,
        SUM(CASE WHEN runs_batter IN (1,2,3) THEN 1 ELSE 0 END) rot,
        SUM(CASE WHEN runs_batter IN (4,6) THEN runs_batter ELSE 0 END) bnd_runs
        FROM sd WHERE {LEGAL} {extra} GROUP BY batter_id"""
    return {r["pid"]: r for r in _rows(conn, sql, params) if r["pid"] and r["balls"]}


def dismissals(conn, extra="", params=()):
    sql = f"""SELECT player_out_id pid, COUNT(*) outs FROM sd
        WHERE player_out_id IS NOT NULL {extra} GROUP BY player_out_id"""
    return {r["pid"]: r["outs"] for r in _rows(conn, sql, params) if r["pid"]}


def innings_scores(conn):
    by = defaultdict(list)
    for r in _rows(conn, f"""SELECT batter_id pid, SUM(runs_batter) score FROM sd
            WHERE {LEGAL} GROUP BY batter_id, match_id, innings_no"""):
        if r["pid"]:
            by[r["pid"]].append(r["score"])
    return by


def _bm(a, outs):
    runs, balls = a["runs"], a["balls"]
    return {"balls": balls, "runs": runs, "outs": outs,
            "sr": round(100 * runs / balls, 1) if balls else 0,
            "avg": round(runs / outs, 1) if outs else (float(runs) if runs else 0.0),
            "boundary_pct": round(100 * a["boundaries"] / balls, 1) if balls else 0,
            "dot_pct": round(100 * a["dots"] / balls, 1) if balls else 0,
            "rps": round(runs / a["scoring"], 2) if a["scoring"] else 0,
            "boundary_dep": round(100 * a["bnd_runs"] / runs, 1) if runs else 0, "sixes": a["sixes"],
            "singles_pct": round(100 * a.get("ones", 0) / balls, 1) if balls else 0,
            "strike_rot": round(100 * a.get("rot", 0) / balls, 1) if balls else 0}


def bowling_table(conn, extra="", params=()):
    sql = f"""SELECT bowler_id pid,
        SUM(CASE WHEN {LEGAL} THEN 1 ELSE 0 END) balls, SUM(runs_batter+runs_extras) runs,
        SUM(CASE WHEN wicket_kind IS NOT NULL AND wicket_kind NOT IN
            ('run out','retired hurt','retired out','obstructing the field','timed out',
             'handled the ball') THEN 1 ELSE 0 END) wickets,
        SUM(CASE WHEN (runs_batter+runs_extras)=0 AND {LEGAL} THEN 1 ELSE 0 END) dots,
        SUM(CASE WHEN runs_batter IN (4,6) THEN 1 ELSE 0 END) bnd
        FROM sd WHERE 1=1 {extra} GROUP BY bowler_id"""
    out = {}
    for r in _rows(conn, sql, params):
        if not r["pid"] or not r["balls"]:
            continue
        b = r["balls"]
        out[r["pid"]] = {"balls": b, "runs": r["runs"], "wickets": r["wickets"],
            "economy": round(r["runs"] / (b / 6), 2) if b else 0,
            "bowl_avg": round(r["runs"] / r["wickets"], 1) if r["wickets"] else None,
            "bowl_sr": round(b / r["wickets"], 1) if r["wickets"] else None,
            "dot_pct": round(100 * r["dots"] / b, 1) if b else 0,
            "bnd_pct": round(100 * r["bnd"] / b, 1) if b else 0}
    return out


def percentiles(values, invert=False):
    items = [(k, v) for k, v in values.items() if v is not None]
    if len(items) < 3:
        return {k: 50.0 for k, _ in items}
    xs = np.array([v for _, v in items], float)
    order = xs.argsort(); ranks = np.empty_like(order, float)
    ranks[order] = np.arange(1, len(xs) + 1)
    pct = ranks / len(xs) * 100
    if invert:
        pct = 100 - pct + (100 / len(xs))
    return {items[i][0]: round(float(pct[i]), 1) for i in range(len(items))}


def linfit(pids, x, y, names, z_thresh=2.5):
    x = np.array(x, float); y = np.array(y, float)
    if len(x) < 6:
        return {"slope": 0, "intercept": 0, "points": []}
    slope, intercept = np.polyfit(x, y, 1)
    resid = y - (slope * x + intercept)
    z = (resid - resid.mean()) / (resid.std() + 1e-9)
    pts = [{"pid": pids[i], "name": names[i], "x": round(float(x[i]), 2), "y": round(float(y[i]), 2),
            "z": round(float(z[i]), 2), "flag": bool(abs(z[i]) > z_thresh)} for i in range(len(x))]
    return {"slope": round(float(slope), 4), "intercept": round(float(intercept), 4), "points": pts}


def top_partnerships(conn, names, limit=300):
    """Wicket-delimited partnership stands across the cohort, biggest first.
    A stand = runs (incl. extras) added while the same two batsmen are at the crease,
    ended by any dismissal. Walks deliveries in order (cheap single pass)."""
    rows = _rows(conn, """SELECT match_id, innings_no, over_no, ball_in_over,
        batter_id, non_striker_id, runs_batter, runs_extras, extra_type, player_out_id
        FROM sd ORDER BY match_id, innings_no, over_no, ball_in_over""")
    stands, cur, last_mi = [], None, None

    def flush():
        nonlocal cur
        if cur and len(cur["bats"]) == 2:
            a, b = sorted(cur["bats"])
            stands.append((a, b, cur["runs"], cur["balls"]))
        cur = None

    for r in rows:
        mi = (r["match_id"], r["innings_no"])
        if mi != last_mi:
            flush(); last_mi = mi
        if cur is None:
            cur = {"runs": 0, "balls": 0, "bats": set()}
        cur["runs"] += (r["runs_batter"] or 0) + (r["runs_extras"] or 0)
        if r["extra_type"] in (None, "byes", "legbyes"):
            cur["balls"] += 1
        if r["batter_id"]:
            cur["bats"].add(r["batter_id"])
        if r["non_striker_id"]:
            cur["bats"].add(r["non_striker_id"])
        if r["player_out_id"]:
            flush()
    flush()
    stands.sort(key=lambda s: s[2], reverse=True)
    out = []
    for a, b, runs, balls in stands[:limit]:
        out.append({"p1": a, "p2": b, "n1": names.get(a, a), "n2": names.get(b, b),
                    "runs": runs, "balls": balls,
                    "rr": round(100 * runs / balls, 1) if balls else 0})
    return out


def top_spells(conn, names, limit=200, min_balls=12, gap=3):
    """Best bowling spells. A spell = a bowler's run of overs in one innings with only
    small gaps between them (they bowl ~every other over from one end); a rest of more
    than `gap` overs starts a new spell. Runs/balls follow bowling_table convention.
    Ranked by wickets, then economy."""
    wkt_bowler = ("bowled", "caught", "lbw", "stumped", "caught and bowled", "hit wicket")
    rows = _rows(conn, """SELECT match_id, innings_no, over_no, bowler_id,
        runs_batter, runs_extras, extra_type, wicket_kind FROM sd
        ORDER BY match_id, innings_no, over_no, ball_in_over""")
    ov = defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))   # (m,inn,bowler) -> over -> [runs,balls,wkts]
    for r in rows:
        if not r["bowler_id"]:
            continue
        cell = ov[(r["match_id"], r["innings_no"], r["bowler_id"])][r["over_no"]]
        cell[0] += (r["runs_batter"] or 0) + (r["runs_extras"] or 0)
        if r["extra_type"] in (None, "byes", "legbyes"):
            cell[1] += 1
        if r["wicket_kind"] in wkt_bowler:
            cell[2] += 1
    spells = []
    for (mid, _inn, bowler), overs in ov.items():
        cur, prev = None, None
        for o in sorted(overs):
            if cur is None or o - prev > gap:
                if cur and cur["balls"] >= min_balls:
                    spells.append(cur)
                cur = {"bowler": bowler, "runs": 0, "balls": 0, "wkts": 0, "overs": 0, "match_id": mid}
            c = overs[o]
            cur["runs"] += c[0]; cur["balls"] += c[1]; cur["wkts"] += c[2]; cur["overs"] += 1
            prev = o
        if cur and cur["balls"] >= min_balls:
            spells.append(cur)
    spells.sort(key=lambda s: (-s["wkts"], s["runs"] / max(s["balls"], 1)))
    out = []
    for s in spells[:limit]:
        out.append({"pid": s["bowler"], "name": names.get(s["bowler"], s["bowler"]),
                    "overs": s["overs"], "balls": s["balls"], "runs": s["runs"], "wkts": s["wkts"],
                    "econ": round(6 * s["runs"] / s["balls"], 2) if s["balls"] else 0})
    return out


def build_cohort(conn, spec, names):
    n, cov = make_scope(conn, spec)
    if n == 0:
        return None
    fmt = spec["format"]
    rmin_b = RATE_MIN_BAT.get(fmt, 60)
    rmin_w = RATE_MIN_BOWL.get(fmt, 60)
    rpo = RPO.get(fmt, 6.0)

    oa, oo = batting_table(conn), dismissals(conn)
    phases = {p: batting_table(conn, "AND phase=?", (p,)) for p in ("powerplay", "middle", "death")}
    phout = {ph: {} for ph in ("powerplay", "middle", "death")}
    for r in _rows(conn, """SELECT player_out_id pid,
            SUM(CASE WHEN phase='powerplay' THEN 1 ELSE 0 END) pp,
            SUM(CASE WHEN phase='middle' THEN 1 ELSE 0 END) md,
            SUM(CASE WHEN phase='death' THEN 1 ELSE 0 END) de
            FROM sd WHERE player_out_id IS NOT NULL GROUP BY player_out_id"""):
        if r["pid"]:
            phout["powerplay"][r["pid"]] = r["pp"]; phout["middle"][r["pid"]] = r["md"]; phout["death"][r["pid"]] = r["de"]
    CTXS = [("win", "is_win=1"), ("loss", "is_win=0"), ("chase", "is_chase=1"),
            ("defend", "is_chase=0"), ("knockout", "is_knockout=1")]
    selb = ", ".join(f"SUM(CASE WHEN {cond} THEN 1 ELSE 0 END) {cn}_b, "
                     f"SUM(CASE WHEN {cond} THEN runs_batter ELSE 0 END) {cn}_r" for cn, cond in CTXS)
    ctx_bat = {r["pid"]: r for r in _rows(conn, f"SELECT batter_id pid, {selb} FROM sd WHERE {LEGAL} GROUP BY batter_id") if r["pid"]}
    selo = ", ".join(f"SUM(CASE WHEN {cond} THEN 1 ELSE 0 END) {cn}_o" for cn, cond in CTXS)
    ctx_out = {r["pid"]: r for r in _rows(conn, f"SELECT player_out_id pid, {selo} FROM sd WHERE player_out_id IS NOT NULL GROUP BY player_out_id") if r["pid"]}
    inn = innings_scores(conn)

    allbat = list(oa.keys())                                   # everyone who faced a ball
    qbat = [p for p in allbat if oa[p]["balls"] >= rmin_b]      # rate-qualified
    bat = {}
    for p in allbat:
        m = _bm(oa[p], oo.get(p, 0)); sc = inn.get(p, [])
        fifties = sum(1 for s in sc if 50 <= s < 100); hundreds = sum(1 for s in sc if s >= 100)
        starts = sum(1 for s in sc if s >= 50)
        m.update(innings=len(sc), fifties=fifties, hundreds=hundreds, highest=max(sc) if sc else 0,
                 conversion=round(100 * hundreds / starts, 1) if starts else 0,
                 consistency=round(max(0.0, 1 - (np.std(sc) / (np.mean(sc) + 1e-9))) * 100, 1) if len(sc) > 1 else 0,
                 qualified=bool(oa[p]["balls"] >= rmin_b))
        m["phases"] = {ph: _bm(phases[ph][p], phout[ph].get(p, 0)) for ph in phases if p in phases[ph]}
        m["context"] = {}
        cb = ctx_bat.get(p); co = ctx_out.get(p) or {}
        if cb:
            for cn, _cond in CTXS:
                balls = cb[cn + "_b"] or 0
                if balls >= 12:
                    runs = cb[cn + "_r"] or 0; outs = co.get(cn + "_o") or 0
                    m["context"][cn] = {"avg": round(runs / outs, 1) if outs else float(runs),
                                        "sr": round(100 * runs / balls, 1), "balls": balls, "runs": runs}
        m["name"] = names.get(p, p); bat[p] = m

    # percentiles + archetypes over rate-qualified only
    for metric, inv in [("avg", 0), ("sr", 0), ("boundary_pct", 0), ("dot_pct", 1),
                        ("consistency", 0), ("conversion", 0), ("rps", 0),
]:
        pc = percentiles({p: bat[p].get(metric) for p in qbat}, invert=bool(inv))
        for p in qbat:
            bat[p].setdefault("pct", {})[metric] = pc.get(p, 50.0)
    for p in qbat:
        pc = bat[p]["pct"]; death_sr = bat[p]["phases"].get("death", {}).get("sr", 0)
        if pc["sr"] >= 70 and pc["boundary_pct"] >= 65:
            a = "Aggressor"
        elif pc["avg"] >= 70 and pc["sr"] < 50:
            a = "Anchor"
        elif pc["sr"] >= 75 and death_sr >= rpo * 18:
            a = "Finisher"
        elif pc["avg"] >= 60 and pc["sr"] >= 55:
            a = "Accumulator"
        else:
            a = "Rotator"
        bat[p]["archetype"] = a
    for p in allbat:
        bat[p].setdefault("archetype", None)

    # ---- advanced derived batting metrics ----
    rrr_min = rpo * 1.15
    pa = batting_table(conn, "AND is_chase=1 AND runs_required IS NOT NULL AND balls_remaining>0 "
                             "AND (runs_required*6.0/balls_remaining) >= ?", (rrr_min,))
    for p in allbat:
        m = bat[p]
        pp = m["phases"].get("powerplay", {}).get("sr"); de = m["phases"].get("death", {}).get("sr")
        m["accel_index"] = round(de / pp, 2) if (pp and de and pp > 0) else None
        if p in pa and pa[p]["balls"] >= 15:
            m["pressure_sr"] = round(100 * pa[p]["runs"] / pa[p]["balls"], 1); m["pressure_balls"] = pa[p]["balls"]
        else:
            m["pressure_sr"] = None; m["pressure_balls"] = pa[p]["balls"] if p in pa else 0
        ko = m["context"].get("knockout")
        m["clutch_index"] = round(100 * ko["sr"] / m["sr"]) if (ko and ko.get("balls", 0) >= 15 and m["sr"]) else None
        wn = m["context"].get("win")
        m["win_sr_ratio"] = round(100 * wn["sr"] / m["sr"]) if (wn and wn.get("balls", 0) >= 15 and m["sr"]) else None

    # era-adjusted batting index: actual runs vs era-expected (per-year cohort run/ball baseline).
    # Skipped for very large (multi-day) cohorts to stay within compute budget.
    ERA_MAX = 1900000
    base, bbase = {}, {}
    if n <= ERA_MAX:
        for r in _rows(conn, f"SELECT yr, SUM(runs_batter) br, SUM(runs_batter+runs_extras) tr, SUM(CASE WHEN {LEGAL} THEN 1 ELSE 0 END) balls FROM sd GROUP BY yr"):
            if r["yr"] and r["balls"]:
                base[r["yr"]] = r["br"] / r["balls"]; bbase[r["yr"]] = r["tr"] / r["balls"]
        py = defaultdict(lambda: [0.0, 0.0])
        for r in _rows(conn, f"SELECT batter_id pid, yr, SUM(runs_batter) runs, SUM(CASE WHEN {LEGAL} THEN 1 ELSE 0 END) balls FROM sd GROUP BY batter_id, yr"):
            if r["pid"] and r["yr"] in base:
                py[r["pid"]][0] += r["runs"]; py[r["pid"]][1] += r["balls"] * base[r["yr"]]
        for p in allbat:
            a, e = py.get(p, [0, 0]); bat[p]["era_index"] = round(100 * a / e) if e > 0 else None
    else:
        for p in allbat:
            bat[p]["era_index"] = None

    # ---- collapse resistance: scoring once the innings is several wickets down ----
    KCOL = {"t20": 3, "odi": 4, "test": 4}.get(fmt, 3)
    if n <= ERA_MAX:
        # fall point of the K-th wicket per innings (window over wicket rows only = tiny)
        conn.execute("DROP TABLE IF EXISTS fp")
        conn.execute(f"""CREATE TEMP TABLE fp AS
            WITH wk AS (SELECT match_id, innings_no, (over_no*6+ball_in_over) AS ord,
                ROW_NUMBER() OVER (PARTITION BY match_id, innings_no ORDER BY over_no, ball_in_over) rn
                FROM sd WHERE wicket_kind IS NOT NULL)
            SELECT match_id, innings_no, ord AS fall_ord FROM wk WHERE rn={KCOL}""")
        conn.execute("CREATE INDEX ix_fp ON fp(match_id, innings_no)")
        col = {}
        for r in _rows(conn, f"""SELECT s.batter_id pid, COUNT(*) balls, SUM(s.runs_batter) runs,
                SUM(CASE WHEN s.player_out_id=s.batter_id THEN 1 ELSE 0 END) outs
              FROM sd s JOIN fp ON fp.match_id=s.match_id AND fp.innings_no=s.innings_no
              WHERE (s.over_no*6+s.ball_in_over) > fp.fall_ord AND {LEGAL}
              GROUP BY s.batter_id"""):
            if r["pid"] and r["balls"]:
                col[r["pid"]] = r
        for p in allbat:
            cr = col.get(p); m = bat[p]
            if cr and cr["balls"] >= 15:
                csr = round(100 * cr["runs"] / cr["balls"], 1)
                m["collapse_sr"] = csr
                m["collapse_avg"] = round(cr["runs"] / cr["outs"], 1) if cr["outs"] else None
                m["collapse_balls"] = cr["balls"]
                m["collapse_resist"] = round(100 * csr / m["sr"]) if m["sr"] else None
            else:
                m["collapse_sr"] = None; m["collapse_avg"] = None
                m["collapse_balls"] = cr["balls"] if cr else 0; m["collapse_resist"] = None
    else:
        for p in allbat:
            bat[p].update(collapse_sr=None, collapse_avg=None, collapse_balls=0, collapse_resist=None)

    # ---- partnership dependence: concentration of runs across batting partners ----
    pruns = defaultdict(dict)
    for r in _rows(conn, f"SELECT batter_id b, non_striker_id w, SUM(runs_batter) r FROM sd "
                         f"WHERE {LEGAL} AND non_striker_id IS NOT NULL GROUP BY batter_id, non_striker_id"):
        if r["b"] and r["w"] and r["r"]:
            pruns[r["b"]][r["w"]] = r["r"]
    for p in allbat:
        pr = pruns.get(p, {}); tot = sum(pr.values()); m = bat[p]
        if tot >= 50 and pr:
            H = sum((v / tot) ** 2 for v in pr.values())
            tw = max(pr, key=pr.get)
            m["partner_dep"] = round(100 * H, 1)
            m["n_partners"] = len(pr)
            m["top_partner"] = names.get(tw, tw)
            m["top_partner_runs"] = pr[tw]
            m["top_partner_share"] = round(100 * pr[tw] / tot, 1)
        else:
            m["partner_dep"] = None; m["n_partners"] = len(pr); m["top_partner"] = None

    ball = bowling_table(conn)
    allbowl = list(ball.keys())
    qbowl = [p for p in allbowl if ball[p]["balls"] >= rmin_w]
    bowl = {p: {**ball[p], "name": names.get(p, p), "phases": {},
                "qualified": bool(ball[p]["balls"] >= rmin_w)} for p in allbowl}
    for ph in ("powerplay", "middle", "death"):
        t = bowling_table(conn, "AND phase=?", (ph,))
        for p in allbowl:
            if p in t and t[p]["balls"] >= 18:
                bowl[p]["phases"][ph] = {k: t[p][k] for k in ("economy", "dot_pct", "wickets", "balls")}
    for metric, inv in [("economy", 1), ("bowl_sr", 1), ("dot_pct", 0)]:
        pc = percentiles({p: bowl[p][metric] for p in qbowl if bowl[p][metric] is not None}, invert=bool(inv))
        for p in pc:
            bowl[p].setdefault("pct", {})[metric] = pc[p]

    if bbase:
        pyb = defaultdict(lambda: [0.0, 0.0])
        for r in _rows(conn, f"SELECT bowler_id pid, yr, SUM(runs_batter+runs_extras) runs, SUM(CASE WHEN {LEGAL} THEN 1 ELSE 0 END) balls FROM sd GROUP BY bowler_id, yr"):
            if r["pid"] and r["yr"] in bbase:
                pyb[r["pid"]][0] += r["runs"]; pyb[r["pid"]][1] += r["balls"] * bbase[r["yr"]]
        for p in allbowl:
            a, e = pyb.get(p, [0, 0]); bowl[p]["era_index"] = round(100 * e / a) if a > 0 else None
    else:
        for p in allbowl:
            bowl[p]["era_index"] = None

    minballs = 18 if fmt == "test" else 12
    mu = _rows(conn, f"""SELECT batter_id b, bowler_id w,
        SUM(CASE WHEN {LEGAL} THEN 1 ELSE 0 END) balls, SUM(runs_batter) runs,
        SUM(CASE WHEN player_out_id=batter_id THEN 1 ELSE 0 END) outs
        FROM sd GROUP BY batter_id,bowler_id HAVING balls>=?""", (minballs,))
    per_bat, matchups = defaultdict(list), []
    for r in mu:
        if not r["b"] or not r["w"] or not r["balls"]:
            continue
        rr_edge = (r["runs"] / r["balls"]) - (rpo / 6); dis = r["outs"] / r["balls"]
        raw = 1 / (1 + math.exp(-(2.2 * rr_edge - 26 * dis)))
        dom = round((r["balls"] * raw + 12 * 0.5) / (r["balls"] + 12), 2)
        rec = {"batter": r["b"], "batter_name": names.get(r["b"], r["b"]), "bowler": r["w"],
               "bowler_name": names.get(r["w"], r["w"]), "balls": r["balls"], "runs": r["runs"],
               "outs": r["outs"], "sr": round(100 * r["runs"] / r["balls"], 1),
               "avg": round(r["runs"] / r["outs"], 1) if r["outs"] else None, "dominance": dom}
        matchups.append(rec); per_bat[r["b"]].append(rec)
    for p in bat:
        bat[p]["matchups"] = sorted(per_bat.get(p, []), key=lambda x: x["balls"], reverse=True)[:8]

    # similarity over rate-qualified set
    feats = ["avg", "sr", "boundary_pct", "dot_pct", "consistency", "conversion"]
    ids = list(qbat)
    if len(ids) >= 4:
        X = np.array([[bat[p][f] for f in feats] for p in ids], float)
        Xs = (X - X.mean(0)) / (X.std(0) + 1e-9)
        Xn = Xs / (np.linalg.norm(Xs, axis=1, keepdims=True) + 1e-9)
        sim = Xn @ Xn.T
        for i, p in enumerate(ids):
            order = np.argsort(-sim[i])
            top = [int(j) for j in order if j != i][:6]
            bat[p]["similar"] = [{"pid": ids[j], "name": names.get(ids[j], ids[j]),
                                  "score": round(float(sim[i, j]), 3)} for j in top]

    def pair(mx, my):
        return linfit(qbat, [bat[p][mx] for p in qbat], [bat[p][my] for p in qbat],
                      [names.get(p, p) for p in qbat])
    outliers = {"avg_vs_sr": {"x": "Average", "y": "Strike Rate", **pair("avg", "sr")},
                "boundary_vs_dot": {"x": "Boundary %", "y": "Dot %", **pair("boundary_pct", "dot_pct")},
                "avg_vs_consistency": {"x": "Average", "y": "Consistency %", **pair("avg", "consistency")}}

    qbs = [p for p in qbowl if bowl[p].get("bowl_sr") is not None]
    def bpair(mx, my):
        return linfit(qbs, [bowl[p][mx] for p in qbs], [bowl[p][my] for p in qbs],
                      [names.get(p, p) for p in qbs])
    bowl_outliers = {"econ_vs_sr": {"x": "Economy", "y": "Strike Rate", **bpair("economy", "bowl_sr")},
                     "dot_vs_econ": {"x": "Dot %", "y": "Economy", **bpair("dot_pct", "economy")}}

    venues = []
    CV = "TRIM(CASE WHEN instr(m.venue,',')>0 THEN substr(m.venue,1,instr(m.venue,',')-1) ELSE m.venue END)"
    vcounts = _rows(conn, f"""SELECT {CV} v, MAX(m.city) city, COUNT(*) c
        FROM dim_match m JOIN sm ON sm.match_id=m.match_id
        WHERE m.venue IS NOT NULL GROUP BY {CV} HAVING c>=2 ORDER BY c DESC LIMIT 500""")
    avg1, avg2 = {}, {}
    for r in _rows(conn, f"""SELECT {CV} v, i.innings_no inn, AVG(i.runs) ar
        FROM fact_innings i JOIN sm ON sm.match_id=i.match_id JOIN dim_match m ON m.match_id=i.match_id
        WHERE m.venue IS NOT NULL GROUP BY {CV}, i.innings_no"""):
        (avg1 if r["inn"] == 1 else avg2 if r["inn"] == 2 else {})[r["v"]] = r["ar"]
    bfw, ntot = {}, {}
    for r in _rows(conn, f"""SELECT {CV} v,
            SUM(CASE WHEN m.winner=bf.batting_team THEN 1 ELSE 0 END) bfw, COUNT(*) n
        FROM dim_match m JOIN sm ON sm.match_id=m.match_id JOIN bf ON bf.match_id=m.match_id
        WHERE m.venue IS NOT NULL AND m.winner IS NOT NULL GROUP BY {CV}"""):
        bfw[r["v"]] = r["bfw"] or 0; ntot[r["v"]] = r["n"] or 0
    for v in vcounts:
        vn = v["v"]; nn = ntot.get(vn, 0); bw = bfw.get(vn, 0)
        first = avg1.get(vn); second = avg2.get(vn)
        venues.append({"venue": vn, "city": v["city"], "matches": v["c"],
                       "avg_first": round(first, 1) if first else None,
                       "avg_second": round(second, 1) if second else None,
                       "bat_first_win_pct": round(100 * bw / nn, 1) if nn else None,
                       "chase_win_pct": round(100 * (nn - bw) / nn, 1) if nn else None})

    for metric, inv in [("strike_rot", 0), ("era_index", 0), ("pressure_sr", 0),
                        ("accel_index", 0), ("clutch_index", 0), ("collapse_resist", 0), ("partner_dep", 1)]:
        pc = percentiles({p: bat[p].get(metric) for p in qbat if bat[p].get(metric) is not None}, invert=bool(inv))
        for p in pc:
            bat[p].setdefault("pct", {})[metric] = pc[p]
    bep = percentiles({p: bowl[p].get("era_index") for p in qbowl if bowl[p].get("era_index") is not None})
    for p in bep:
        bowl[p].setdefault("pct", {})["era_index"] = bep[p]

    def top(metric, src=None, reverse=True, key=None, n=LIST_CAP, qualified_only=False):
        src = src if src is not None else bat
        kf = key or (lambda p: src[p].get(metric))
        pool = src.keys()
        if qualified_only:
            pool = [p for p in src if src[p].get("qualified")]
        rows = sorted([(p, kf(p)) for p in pool if kf(p) is not None], key=lambda x: x[1], reverse=reverse)
        return [{"pid": p, "name": src[p].get("name", p),
                 "value": round(v, 1) if isinstance(v, float) else v} for p, v in rows[:n]]

    records = {
        # counting stats: everyone
        "most_runs": top("runs"), "most_sixes": top("sixes"), "most_hundreds": top("hundreds"),
        "most_fifties": top("fifties"), "most_innings": top("innings"),
        "most_wickets": top("wickets", src=bowl),
        # rate stats: qualified only
        "highest_avg": top("avg", qualified_only=True),
        "highest_sr": top("sr", qualified_only=True),
        "best_consistency": top("consistency", qualified_only=True),
        "best_conversion": top("conversion", qualified_only=True),
        "best_chase_avg": top("chase_avg", qualified_only=True,
                              key=lambda p: bat[p]["context"].get("chase", {}).get("avg")),
        "best_death_sr": top("death_sr", qualified_only=True,
                            key=lambda p: bat[p]["phases"].get("death", {}).get("sr")),
        "best_economy": top("economy", src=bowl, reverse=False, qualified_only=True),
        "best_bowl_sr": top("bowl_sr", src=bowl, reverse=False, qualified_only=True),
        "best_dot_pct_bowl": top("dot_pct", src=bowl, qualified_only=True),
        # advanced / derived
        "highest_era_index": top("era_index", qualified_only=True),
        "best_strike_rotation": top("strike_rot", qualified_only=True),
        "best_acceleration": top("accel_index", qualified_only=True),
        "best_pressure_sr": top("pressure_sr", qualified_only=True),
        "best_clutch": top("clutch_index", qualified_only=True),
        "best_era_index_bowl": top("era_index", src=bowl, qualified_only=True),
        "best_collapse_resist": top("collapse_resist", qualified_only=True),
        "most_self_reliant": top("partner_dep", reverse=False, qualified_only=True),
    }

    arch_dist = defaultdict(int)
    for p in qbat:
        if bat[p].get("archetype"):
            arch_dist[bat[p]["archetype"]] += 1

    return {"meta": {"key": spec["key"], "label": spec["label"], "format": fmt,
                     "gender": spec.get("gender"), "intl": bool(spec.get("intl")),
                     "deliveries": n, "matches": cov[2],
                     "coverage_from": cov[0], "coverage_to": cov[1],
                     "rate_min_bat": rmin_b, "rate_min_bowl": rmin_w,
                     "n_batters": len(allbat), "n_bowlers": len(allbowl),
                     "n_qual_bat": len(qbat), "n_qual_bowl": len(qbowl),
                     "archetypes": dict(arch_dist)},
            "players": bat, "bowlers": bowl,
            "matchups_top": sorted(matchups, key=lambda x: x["balls"], reverse=True)[:400],
            "outliers": outliers, "bowl_outliers": bowl_outliers, "venues": venues, "records": records,
            "partnerships": top_partnerships(conn, names),
            "spells": top_spells(conn, names),
            "teams": team_records(conn)}


def team_records(conn):
    """Win/loss by team over the current cohort scope (sm), mirroring serve.py /api/teams."""
    rows = _rows(conn, """WITH m AS (SELECT d.team_a a, d.team_b b, d.winner w
            FROM dim_match d JOIN sm ON sm.match_id=d.match_id)
        SELECT team, COUNT(*) mp, SUM(win) wins FROM (
          SELECT a team, CASE WHEN w=a THEN 1 ELSE 0 END win FROM m WHERE a IS NOT NULL
          UNION ALL SELECT b team, CASE WHEN w=b THEN 1 ELSE 0 END win FROM m WHERE b IS NOT NULL
        ) GROUP BY team HAVING mp>=3 ORDER BY mp DESC""")
    return [{"team": r["team"], "matches": r["mp"], "wins": r["wins"] or 0,
             "winpct": round(100 * (r["wins"] or 0) / r["mp"], 1) if r["mp"] else 0} for r in rows]


def global_profiles(conn):
    """All-format per-batter career (runs by year) and top-14 venues, mirroring serve.py
    /api/career and /api/venues_player. Computed once over the whole DB, keyed by player id."""
    LB = "(d.extra_type IS NULL OR d.extra_type<>'wides')"
    career = defaultdict(list)
    for r in _rows(conn, f"""SELECT d.batter_id pid, substr(m.match_date,1,4) yr,
            SUM(d.runs_batter) runs, SUM(CASE WHEN {LB} THEN 1 ELSE 0 END) balls,
            COUNT(DISTINCT d.match_id||'-'||d.innings_no) inns,
            SUM(CASE WHEN d.player_out_id=d.batter_id THEN 1 ELSE 0 END) outs
        FROM fact_delivery d JOIN dim_match m ON m.match_id=d.match_id
        WHERE m.match_date IS NOT NULL GROUP BY d.batter_id, yr"""):
        if not r["pid"] or not r["yr"] or not str(r["yr"]).isdigit() or not r["balls"]:
            continue
        runs, balls, outs = r["runs"] or 0, r["balls"] or 0, r["outs"] or 0
        career[r["pid"]].append({"year": int(r["yr"]), "runs": runs, "balls": balls, "inns": r["inns"] or 0,
            "avg": round(runs / outs, 1) if outs else runs, "sr": round(100 * runs / balls, 1) if balls else 0})
    vraw = defaultdict(list)
    for r in _rows(conn, f"""SELECT d.batter_id pid, m.venue venue, m.city city,
            SUM(d.runs_batter) runs, SUM(CASE WHEN {LB} THEN 1 ELSE 0 END) balls,
            COUNT(DISTINCT d.match_id||'-'||d.innings_no) inns,
            SUM(CASE WHEN d.player_out_id=d.batter_id THEN 1 ELSE 0 END) outs
        FROM fact_delivery d JOIN dim_match m ON m.match_id=d.match_id
        WHERE m.venue IS NOT NULL AND m.venue<>'' GROUP BY d.batter_id, m.venue"""):
        if not r["pid"] or not r["balls"]:
            continue
        runs, balls, outs = r["runs"] or 0, r["balls"] or 0, r["outs"] or 0
        vraw[r["pid"]].append({"venue": r["venue"], "city": r["city"] or "", "runs": runs, "balls": balls,
            "inns": r["inns"] or 0, "avg": round(runs / outs, 1) if outs else runs,
            "sr": round(100 * runs / balls, 1) if balls else 0})
    venues = {pid: sorted(v, key=lambda x: -x["runs"])[:14] for pid, v in vraw.items()}
    # drop trivial samples (<24 balls faced) so the file stays lean and timelines are meaningful
    career = {pid: ys for pid, ys in career.items() if sum(y["balls"] for y in ys) >= 24}
    venues = {pid: vs for pid, vs in venues.items() if sum(v["balls"] for v in vs) >= 24}
    return career, venues


def _awrite(path, data):
    """Atomic write: temp file + fsync + os.replace, so a reader never sees a half-written file."""
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def build(db="cil.db", outdir="web/data", jsdir="web/dashboard/cohorts"):
    conn = sqlite3.connect(db)
    conn.execute("PRAGMA temp_store=MEMORY")
    names = {r["player_id"]: r["name"] for r in _rows(conn, "SELECT player_id,name FROM dim_player")}
    os.makedirs(outdir, exist_ok=True)
    os.makedirs(jsdir, exist_ok=True)
    specs = FIXED + discover_league_cohorts(conn)
    index = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "cohorts": []}
    spec_by_key = {s["key"]: s for s in specs}
    for spec in specs:
        jpath = os.path.join(outdir, f"{spec['key']}.json")
        if os.path.exists(jpath):
            print(f"  {spec['key']}: exists, skip"); continue
        t = time.time()
        b = build_cohort(conn, spec, names)
        if not b or b["meta"]["n_batters"] < 4:
            print(f"  {spec['key']}: too small, skipped"); continue
        payload = json.dumps(b, separators=(",", ":"))
        _awrite(jpath, payload)
        _awrite(os.path.join(jsdir, f"{spec['key']}.js"),
                f"window.__cohortLoaded({json.dumps(spec['key'])},{payload});")
        _awrite(os.path.join(outdir, f"{spec['key']}.meta.json"),
                json.dumps({**b["meta"], "bytes": len(payload)}))
        print(f"  {spec['key']}: {b['meta']['n_batters']}bat/{b['meta']['n_bowlers']}bowl "
              f"({b['meta']['n_qual_bat']}q) {b['meta']['matches']}m "
              f"{b['meta']['coverage_from']}..{b['meta']['coverage_to']} {len(payload)//1024}KB {time.time()-t:.1f}s")
    # (re)build the index from whatever cohort metas exist, in spec order
    index["cohorts"] = []
    for spec in specs:
        mp = os.path.join(outdir, f"{spec['key']}.meta.json")
        if os.path.exists(mp):
            index["cohorts"].append(json.load(open(mp)))
    _awrite(os.path.join(outdir, "index.json"), json.dumps(index, indent=2))
    _awrite(os.path.join(os.path.dirname(jsdir), "index.js"),
            "window.CIL_INDEX=" + json.dumps(index, separators=(",", ":")) + ";")
    career, venues = global_profiles(conn)
    _awrite(os.path.join(os.path.dirname(jsdir), "careers.js"),
            "window.CIL_CAREER=" + json.dumps(career, separators=(",", ":")) + ";\n"
            + "window.CIL_VENUES=" + json.dumps(venues, separators=(",", ":")) + ";\n")
    print(f"  careers.js: {len(career)} batters with career, {len(venues)} with venues")
    conn.close()
    return index


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="cil.db")
    ap