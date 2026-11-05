"""Lazy per-cohort extras: everything the dashboard needs beyond the main bundle.

Written to web/dashboard/cohorts/x/<key>.js and loaded on demand, so the main cohort
bundle (and first paint) doesn't grow. Runs inside build() right after build_cohort(),
while the temp scope tables (sd = this cohort's deliveries, sm = its matches) still exist.

Contents (all compact arrays, keyed by player index into `p`):
  yb    per-year batting   [pi, year, balls, runs, outs, inns, 50s, 100s, 4s, 6s, dots]
  yw    per-year bowling   [pi, year, balls, runs, wkts, dots, 4s+6s conceded]
  venues  per ground: first-innings average by year, toss decision effect, top batters/bowlers
  teams   per team: results by year, head-to-head vs every opponent, top batters/bowlers
  recent  the latest matches with over-by-over runs/wickets and top performers
  week    standout innings / spells from the last 30 days of data
"""
from __future__ import annotations
import json
from collections import defaultdict

LEGAL = "(extra_type IS NULL OR extra_type IN ('byes','legbyes'))"
# Batting counts every delivery except wides: a no-ball is a ball faced and its runs off the bat
# count. (LEGAL, which also drops no-balls, is the bowler/over definition.)
BAT = "(extra_type IS NULL OR extra_type <> 'wides')"
BOWLER_WKT = ("wicket_kind IS NOT NULL AND wicket_kind NOT IN ('run out','retired hurt','retired out',"
              "'obstructing the field','timed out','handled the ball')")
CV = "TRIM(CASE WHEN instr(m.venue,',')>0 THEN substr(m.venue,1,instr(m.venue,',')-1) ELSE m.venue END)"
RECENT_MATCHES = 40
# ICC Full Members. "Full members only" restricts international stats to matches where both
# sides are full members, so records built against associates don't dominate the boards.
FULL_MEMBERS = ("Afghanistan", "Australia", "Bangladesh", "England", "India", "Ireland", "New Zealand",
                "Pakistan", "South Africa", "Sri Lanka", "West Indies", "Zimbabwe")
PHASES = ("powerplay", "middle", "death")


def _rows(conn, sql, params=()):
    cur = conn.execute(sql, params)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


class _Ix:
    """Player id -> small int, so rows don't repeat 8-char ids thousands of times."""
    def __init__(self, names):
        self.names, self.ix, self.p = names, {}, []

    def __call__(self, pid):
        if pid not in self.ix:
            self.ix[pid] = len(self.p)
            self.p.append([pid, self.names.get(pid, pid)])
        return self.ix[pid]


def per_year(conn, P, src="sd"):
    """Batting and bowling aggregates per player per calendar year (drives the time filter,
    bowler form charts and milestone tracking in the dashboard)."""
    inns = defaultdict(lambda: [0, 0, 0])  # (pid, yr) -> [innings, 50s, 100s]
    for r in _rows(conn, f"""SELECT batter_id pid, yr, SUM(runs_batter) s FROM {src} WHERE {BAT}
            GROUP BY batter_id, match_id, innings_no"""):
        if r["pid"] and r["yr"]:
            a = inns[(r["pid"], r["yr"])]; s = r["s"] or 0
            a[0] += 1; a[1] += 50 <= s < 100; a[2] += s >= 100
    outs = {(r["pid"], r["yr"]): r["o"] for r in _rows(conn, f"""SELECT player_out_id pid, yr, COUNT(*) o
            FROM {src} WHERE player_out_id IS NOT NULL GROUP BY player_out_id, yr""")}
    yb = []
    for r in _rows(conn, f"""SELECT batter_id pid, yr, COUNT(*) balls, SUM(runs_batter) runs,
            SUM(runs_batter=4) f, SUM(runs_batter=6) s, SUM(runs_batter=0) d
            FROM {src} WHERE {BAT} GROUP BY batter_id, yr"""):
        if not r["pid"] or not r["yr"] or not str(r["yr"]).isdigit():
            continue
        k = (r["pid"], r["yr"]); i = inns.get(k, [0, 0, 0])
        yb.append([P(r["pid"]), int(r["yr"]), r["balls"], r["runs"] or 0, outs.get(k, 0),
                   i[0], i[1], i[2], r["f"] or 0, r["s"] or 0, r["d"] or 0])
    yw = []
    for r in _rows(conn, f"""SELECT bowler_id pid, yr, SUM(CASE WHEN {LEGAL} THEN 1 ELSE 0 END) balls,
            SUM(runs_batter+runs_extras) runs, SUM(CASE WHEN {BOWLER_WKT} THEN 1 ELSE 0 END) w,
            SUM(CASE WHEN (runs_batter+runs_extras)=0 AND {LEGAL} THEN 1 ELSE 0 END) d,
            SUM(runs_batter IN (4,6)) b
            FROM {src} GROUP BY bowler_id, yr"""):
        if not r["pid"] or not r["yr"] or not str(r["yr"]).isdigit() or not r["balls"]:
            continue
        yw.append([P(r["pid"]), int(r["yr"]), r["balls"], r["runs"] or 0, r["w"] or 0, r["d"] or 0, r["b"] or 0])
    return yb, yw


def venue_detail(conn, P, top_n=6):
    """Per ground: first-innings average by year, toss effect, and its best performers."""
    out = {}
    for r in _rows(conn, f"""SELECT {CV} v, substr(m.match_date,1,4) yr, AVG(i.runs) ar, COUNT(*) n
            FROM fact_innings i JOIN sm ON sm.match_id=i.match_id JOIN dim_match m ON m.match_id=i.match_id
            WHERE m.venue IS NOT NULL AND i.innings_no=1 GROUP BY v, yr"""):
        if r["v"] and r["yr"]:
            out.setdefault(r["v"], {"trend": [], "toss": {}, "bat": [], "bowl": []})["trend"].append(
                [int(r["yr"]), round(r["ar"], 1), r["n"]])
    for r in _rows(conn, f"""SELECT {CV} v, m.toss_decision td, COUNT(*) n,
            SUM(CASE WHEN m.winner=m.toss_winner THEN 1 ELSE 0 END) w
            FROM dim_match m JOIN sm ON sm.match_id=m.match_id
            WHERE m.venue IS NOT NULL AND m.winner IS NOT NULL AND m.toss_decision IS NOT NULL GROUP BY v, td"""):
        if r["v"] in out and r["td"]:
            out[r["v"]]["toss"][r["td"]] = [r["n"], r["w"] or 0]
    bat = defaultdict(list)
    for r in _rows(conn, f"""SELECT {CV} v, s.batter_id pid, SUM(s.runs_batter) runs, COUNT(*) balls
            FROM sd s JOIN dim_match m ON m.match_id=s.match_id WHERE {BAT.replace('extra_type', 's.extra_type')}
            AND m.venue IS NOT NULL GROUP BY v, s.batter_id"""):
        if r["v"] in out and r["pid"]:
            bat[r["v"]].append(r)
    for v, rs in bat.items():
        out[v]["bat"] = [[P(r["pid"]), r["runs"], r["balls"]] for r in sorted(rs, key=lambda x: -x["runs"])[:top_n]]
    bowl = defaultdict(list)
    for r in _rows(conn, f"""SELECT {CV} v, s.bowler_id pid,
            SUM(CASE WHEN {BOWLER_WKT.replace('wicket_kind', 's.wicket_kind')} THEN 1 ELSE 0 END) w,
            SUM(s.runs_batter+s.runs_extras) runs, COUNT(*) balls
            FROM sd s JOIN dim_match m ON m.match_id=s.match_id WHERE m.venue IS NOT NULL GROUP BY v, s.bowler_id"""):
        if r["v"] in out and r["pid"] and r["w"]:
            bowl[r["v"]].append(r)
    for v, rs in bowl.items():
        out[v]["bowl"] = [[P(r["pid"]), r["w"], r["runs"], r["balls"]]
                          for r in sorted(rs, key=lambda x: (-x["w"], x["runs"]))[:top_n]]
    for v in out:
        out[v]["trend"].sort()
    return out


def team_detail(conn, P, top_n=8):
    """Per team: results by year, head-to-head vs each opponent, and its leading players."""
    out = {}
    for r in _rows(conn, """SELECT team, opp, substr(match_date,1,4) yr, winner FROM (
            SELECT m.team_a team, m.team_b opp, m.match_date, m.winner FROM dim_match m JOIN sm ON sm.match_id=m.match_id
            UNION ALL
            SELECT m.team_b, m.team_a, m.match_date, m.winner FROM dim_match m JOIN sm ON sm.match_id=m.match_id)
            WHERE team IS NOT NULL AND opp IS NOT NULL"""):
        t = out.setdefault(r["team"], {"years": {}, "h2h": {}, "bat": [], "bowl": []})
        won = 1 if r["winner"] == r["team"] else 0
        lost = 1 if (r["winner"] and r["winner"] == r["opp"]) else 0
        if r["yr"]:
            y = t["years"].setdefault(int(r["yr"]), [0, 0, 0]); y[0] += 1; y[1] += won; y[2] += lost
        h = t["h2h"].setdefault(r["opp"], [0, 0, 0]); h[0] += 1; h[1] += won; h[2] += lost
    bat = defaultdict(list)
    for r in _rows(conn, f"""SELECT batting_team t, batter_id pid, SUM(runs_batter) runs, COUNT(*) balls
            FROM sd WHERE {BAT} AND batting_team IS NOT NULL GROUP BY batting_team, batter_id"""):
        if r["t"] in out and r["pid"]:
            bat[r["t"]].append(r)
    for t, rs in bat.items():
        out[t]["bat"] = [[P(r["pid"]), r["runs"], r["balls"]] for r in sorted(rs, key=lambda x: -x["runs"])[:top_n]]
    bowl = defaultdict(list)
    for r in _rows(conn, f"""SELECT bowling_team t, bowler_id pid, SUM(CASE WHEN {BOWLER_WKT} THEN 1 ELSE 0 END) w,
            SUM(runs_batter+runs_extras) runs, COUNT(*) balls
            FROM sd WHERE bowling_team IS NOT NULL GROUP BY bowling_team, bowler_id"""):
        if r["t"] in out and r["pid"] and r["w"]:
            bowl[r["t"]].append(r)
    for t, rs in bowl.items():
        out[t]["bowl"] = [[P(r["pid"]), r["w"], r["runs"], r["balls"]]
                          for r in sorted(rs, key=lambda x: (-x["w"], x["runs"]))[:top_n]]
    for t in out.values():
        t["years"] = sorted([y] + v for y, v in t["years"].items())
        t["h2h"] = sorted(([o] + v for o, v in t["h2h"].items()), key=lambda x: -x[1])
    return out


def recent_matches(conn, P, n=RECENT_MATCHES):
    """The latest matches in scope: header, innings totals, over-by-over runs/wickets, top performers."""
    ms = _rows(conn, f"""SELECT m.match_id id, m.match_date d, m.venue v, m.city c, m.team_a a, m.team_b b,
            m.winner w, m.result_type rt, m.toss_winner tw, m.toss_decision td, m.stage st
            FROM dim_match m JOIN sm ON sm.match_id=m.match_id ORDER BY m.match_date DESC, m.match_id DESC LIMIT ?""", (n,))
    if not ms:
        return []
    ids = [m["id"] for m in ms]
    ph = ",".join("?" * len(ids))
    overs = defaultdict(lambda: defaultdict(lambda: [0, 0]))   # (id, inn) -> over -> [runs, wkts]
    teams = {}
    for r in _rows(conn, f"""SELECT match_id id, innings_no inn, over_no o, batting_team t,
            SUM(runs_batter+runs_extras) r, SUM(wicket_kind IS NOT NULL) wk
            FROM sd WHERE match_id IN ({ph}) GROUP BY match_id, innings_no, over_no""", ids):
        overs[(r["id"], r["inn"])][r["o"]] = [r["r"] or 0, r["wk"] or 0]
        teams[(r["id"], r["inn"])] = r["t"]
    bats = defaultdict(list)
    for r in _rows(conn, f"""SELECT match_id id, innings_no inn, batter_id pid, SUM(runs_batter) r,
            SUM(CASE WHEN {BAT} THEN 1 ELSE 0 END) b, MAX(player_out_id=batter_id) o
            FROM sd WHERE match_id IN ({ph}) GROUP BY match_id, innings_no, batter_id""", ids):
        if r["pid"]:
            bats[(r["id"], r["inn"])].append([P(r["pid"]), r["r"] or 0, r["b"] or 0, 1 if r["o"] else 0])
    bowls = defaultdict(list)
    for r in _rows(conn, f"""SELECT match_id id, innings_no inn, bowler_id pid,
            SUM(CASE WHEN {LEGAL} THEN 1 ELSE 0 END) b, SUM(runs_batter+runs_extras) r,
            SUM(CASE WHEN {BOWLER_WKT} THEN 1 ELSE 0 END) w
            FROM sd WHERE match_id IN ({ph}) GROUP BY match_id, innings_no, bowler_id""", ids):
        if r["pid"]:
            bowls[(r["id"], r["inn"])].append([P(r["pid"]), r["b"] or 0, r["r"] or 0, r["w"] or 0])
    out = []
    for m in ms:
        inns = []
        for inn in sorted(k[1] for k in overs if k[0] == m["id"]):
            ov = overs[(m["id"], inn)]
            series = [ov.get(o, [0, 0]) for o in range(0, max(ov) + 1)]
            inns.append({"team": teams.get((m["id"], inn)), "overs": series,
                         "runs": sum(x[0] for x in series), "wkts": sum(x[1] for x in series),
                         "bat": sorted(bats[(m["id"], inn)], key=lambda x: (-x[1], x[2]))[:11],
                         "bowl": sorted(bowls[(m["id"], inn)], key=lambda x: (-x[3], x[2]))[:8]})
        out.append({"id": m["id"], "date": m["d"], "venue": m["v"], "city": m["c"], "teams": [m["a"], m["b"]],
                    "winner": m["w"], "result": m["rt"], "toss": [m["tw"], m["td"]], "stage": m["st"], "inns": inns})
    return out


def this_week(conn, P, days=30, n=30):
    """Standout innings and spells from the last `days` days of data in this cohort."""
    last = conn.execute("SELECT MAX(m.match_date) FROM dim_match m JOIN sm ON sm.match_id=m.match_id").fetchone()[0]
    if not last:
        return None
    lo = conn.execute("SELECT date(?, ?)", (last, f"-{days} days")).fetchone()[0]
    rm = [r["match_id"] for r in _rows(conn, """SELECT m.match_id FROM dim_match m JOIN sm ON sm.match_id=m.match_id
            WHERE m.match_date>=?""", (lo,))]
    if not rm:
        return None
    ph = ",".join("?" * len(rm))
    inn = _rows(conn, f"""SELECT s.batter_id pid, s.match_id id, SUM(s.runs_batter) r,
            SUM(CASE WHEN {BAT.replace('extra_type', 's.extra_type')} THEN 1 ELSE 0 END) b,
            MAX(m.match_date) d, MAX(s.bowling_team) vs, MAX(s.batting_team) t
            FROM sd s JOIN dim_match m ON m.match_id=s.match_id WHERE s.match_id IN ({ph})
            GROUP BY s.batter_id, s.match_id, s.innings_no ORDER BY r DESC LIMIT ?""", rm + [n])
    spl = _rows(conn, f"""SELECT s.bowler_id pid, s.match_id id, SUM(CASE WHEN {BOWLER_WKT.replace('wicket_kind', 's.wicket_kind')} THEN 1 ELSE 0 END) w,
            SUM(s.runs_batter+s.runs_extras) r, MAX(m.match_date) d, MAX(s.batting_team) vs, MAX(s.bowling_team) t,
            SUM(CASE WHEN {LEGAL.replace('extra_type', 's.extra_type')} THEN 1 ELSE 0 END) b
            FROM sd s JOIN dim_match m ON m.match_id=s.match_id WHERE s.match_id IN ({ph})
            GROUP BY s.bowler_id, s.match_id, s.innings_no ORDER BY w DESC, r ASC LIMIT ?""", rm + [n])
    return {"from": lo, "to": last, "matches": len(rm),
            # [player, runs, balls, date, opponent, match id, own team]
            "innings": [[P(r["pid"]), r["r"], r["b"], r["d"], r["vs"], r["id"], r["t"]] for r in inn if r["pid"]],
            # [player, wickets, runs, date, opponent, match id, own team, balls]
            "spells": [[P(r["pid"]), r["w"], r["r"], r["d"], r["vs"], r["id"], r["t"], r["b"]] for r in spl if r["pid"] and r["w"]]}


def full_member_scope(conn):
    """sdfm = this cohort's deliveries from matches where BOTH teams are ICC full members."""
    ph = ",".join("?" * len(FULL_MEMBERS))
    conn.execute("DROP TABLE IF EXISTS sdfm")
    conn.execute(f"""CREATE TEMP TABLE sdfm AS SELECT s.* FROM sd s JOIN dim_match m ON m.match_id=s.match_id
        WHERE m.team_a IN ({ph}) AND m.team_b IN ({ph})""", FULL_MEMBERS + FULL_MEMBERS)
    return conn.execute("SELECT COUNT(DISTINCT match_id) FROM sdfm").fetchone()[0]


def phase_tables(conn, P, src):
    """Per-player phase totals (all seasons) for the scope table: batting [pi, phase, balls, runs, outs],
    bowling [pi, phase, balls, runs, wkts, dots]."""
    bp, wp = [], []
    for r in _rows(conn, f"""SELECT batter_id pid, phase ph, SUM(CASE WHEN {BAT} THEN 1 ELSE 0 END) b,
            SUM(runs_batter) r, SUM(CASE WHEN player_out_id=batter_id THEN 1 ELSE 0 END) o FROM {src} WHERE phase IN ('powerplay','middle','death')
            GROUP BY batter_id, phase"""):
        if r["pid"] and r["b"]:
            bp.append([P(r["pid"]), PHASES.index(r["ph"]), r["b"], r["r"] or 0, r["o"] or 0])
    for r in _rows(conn, f"""SELECT bowler_id pid, phase ph, SUM(CASE WHEN {LEGAL} THEN 1 ELSE 0 END) b,
            SUM(runs_batter+runs_extras) r, SUM(CASE WHEN {BOWLER_WKT} THEN 1 ELSE 0 END) w,
            SUM(CASE WHEN (runs_batter+runs_extras)=0 AND {LEGAL} THEN 1 ELSE 0 END) d
            FROM {src} WHERE phase IN ('powerplay','middle','death') GROUP BY bowler_id, phase"""):
        if r["pid"] and r["b"]:
            wp.append([P(r["pid"]), PHASES.index(r["ph"]), r["b"], r["r"] or 0, r["w"] or 0, r["d"] or 0])
    return bp, wp


def matchups_scope(conn, P, src, rpo, minballs):
    """Batter-vs-bowler pairs in the scope table with the same dominance score as the main bundle."""
    import math
    out = []
    for r in _rows(conn, f"""SELECT batter_id b, bowler_id w, SUM(CASE WHEN {BAT} THEN 1 ELSE 0 END) balls,
            SUM(runs_batter) runs, SUM(CASE WHEN player_out_id=batter_id THEN 1 ELSE 0 END) outs FROM {src}
            GROUP BY batter_id, bowler_id HAVING balls>=?""", (minballs,)):
        if not r["b"] or not r["w"] or not r["balls"]:
            continue
        edge = r["runs"] / r["balls"] - rpo / 6; dis = r["outs"] / r["balls"]
        raw = 1 / (1 + math.exp(-(2.2 * edge - 26 * dis)))
        out.append([P(r["b"]), P(r["w"]), r["balls"], r["runs"] or 0, r["outs"] or 0,
                    round((r["balls"] * raw + 6) / (r["balls"] + 12), 2)])
    return out


def clutch_collapse(conn, P, src, fmt):
    """Per batter in the scope: [pi, balls, runs, knockout balls, knockout runs, balls after a
    collapse, runs after a collapse]. Lets the dashboard recompute clutch index and collapse
    resistance for the full-member scope (pipeline.py computes them for all matches)."""
    k = {"t20": 3, "odi": 4, "test": 4}.get(fmt, 3)
    conn.execute("DROP TABLE IF EXISTS fpx")
    conn.execute(f"""CREATE TEMP TABLE fpx AS
        WITH wk AS (SELECT match_id, innings_no, (over_no*6+ball_in_over) AS ord,
            ROW_NUMBER() OVER (PARTITION BY match_id, innings_no ORDER BY over_no, ball_in_over) rn
            FROM {src} WHERE wicket_kind IS NOT NULL)
        SELECT match_id, innings_no, ord AS fall_ord FROM wk WHERE rn={k}""")
    conn.execute("CREATE INDEX ix_fpx ON fpx(match_id, innings_no)")
    col = {r["pid"]: r for r in _rows(conn, f"""SELECT s.batter_id pid, COUNT(*) b, SUM(s.runs_batter) r
            FROM {src} s JOIN fpx ON fpx.match_id=s.match_id AND fpx.innings_no=s.innings_no
            WHERE (s.over_no*6+s.ball_in_over) > fpx.fall_ord AND {BAT.replace('extra_type', 's.extra_type')}
            GROUP BY s.batter_id""")}
    out = []
    for r in _rows(conn, f"""SELECT batter_id pid, COUNT(*) b, SUM(runs_batter) r,
            SUM(CASE WHEN is_knockout=1 THEN 1 ELSE 0 END) kb, SUM(CASE WHEN is_knockout=1 THEN runs_batter ELSE 0 END) kr
            FROM {src} WHERE {BAT} GROUP BY batter_id"""):
        if not r["pid"] or not r["b"]:
            continue
        c = col.get(r["pid"]) or {"b": 0, "r": 0}
        out.append([P(r["pid"]), r["b"], r["r"] or 0, r["kb"] or 0, r["kr"] or 0, c["b"] or 0, c["r"] or 0])
    return out


def build_extras(conn, names, intl=False, fmt="t20", rpo=8.0):
    P = _Ix(names)
    yb, yw = per_year(conn, P)
    bp, wp = phase_tables(conn, P, "sd")
    data = {"yb": yb, "yw": yw, "bp": bp, "wp": wp, "venues": venue_detail(conn, P), "teams": team_detail(conn, P),
            "recent": recent_matches(conn, P), "week": this_week(conn, P)}
    if intl and full_member_scope(conn):
        fyb, fyw = per_year(conn, P, "sdfm")
        fbp, fwp = phase_tables(conn, P, "sdfm")
        data["fm"] = {"teams": list(FULL_MEMBERS), "yb": fyb, "yw": fyw, "bp": fbp, "wp": fwp,
                      "mu": matchups_scope(conn, P, "sdfm", rpo, 18 if fmt == "test" else 12),
                      "adv": clutch_collapse(conn, P, "sdfm", fmt)}
    data["p"] = P.p
    return data


def write_extras(path, key, data, write):
    write(path, f"window.__extrasLoaded({json.dumps(key)},{json.dumps(data, separators=(',', ':'))});")
