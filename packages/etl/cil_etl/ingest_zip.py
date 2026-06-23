"""Stream Cricsheet matches directly from a downloaded zip (e.g. all_json.zip)
into SQLite. Ingests EVERYTHING the zip contains (every men's & women's match,
all formats and competitions), with correct up-front classification:

  * format     -> 't20', 'odi', or 'test'  (T20/IT20->t20 ; ODI/ODM->odi ; Test/MDM->test)
  * team_type  -> 'international' or 'club'  (from Cricsheet info.team_type)
  * league     -> canonical competition name (sponsor variants collapsed)

This fixes the "T20Is stuck in 2024 / no Indian venues" bug: men's bilateral
T20Is are Cricsheet match_type 'T20' + team_type 'international', NOT 'IT20'.
"""
from __future__ import annotations
import argparse, zipfile, orjson, time, re

from .parse import phase_for, Delivery, Match
from .store import connect, reset

FORMAT_MAP = {"t20": "t20", "it20": "t20", "odi": "odi", "odm": "odi",
              "test": "test", "mdm": "test"}
LIMITED = {"t20", "odi"}

LEAGUE_ALIASES = {
    "specsavers county championship": "County Championship",
    "lv= county championship": "County Championship",
    "lv county championship": "County Championship",
    "friends life t20": "Vitality Blast",
    "natwest t20 blast": "Vitality Blast",
    "vitality blast men": "Vitality Blast",
    "vitality blast women": "Women's Vitality Blast",
    "vitality t20 blast": "Vitality Blast",
    "ram slam t20 challenge": "CSA T20 Challenge",
    "the hundred men's competition": "The Hundred",
    "the hundred women's competition": "Women's Hundred",
}
_YEAR = re.compile(r"\s*(?:19|20)\d\d(?:[/\-]\d\d?)?\s*$")


def league_canon(name):
    if not name:
        return None
    n = _YEAR.sub("", name).strip()
    return LEAGUE_ALIASES.get(n.lower(), n)


def parse_dict(raw, match_id):
    info = raw["info"]
    reg = info.get("registry", {}).get("people", {})
    raw_mt = (info.get("match_type") or "").lower()
    fmt = FORMAT_MAP.get(raw_mt, raw_mt)
    team_type = info.get("team_type")
    ev = info.get("event") or {}
    ev_name = ev.get("name") if isinstance(ev, dict) else None
    stage = ev.get("stage") if isinstance(ev, dict) else None
    is_ko = bool(stage) and any(w in str(stage).lower()
                                for w in ("final", "qualifier", "eliminator", "semi", "playoff"))
    outcome = info.get("outcome", {})
    winner = outcome.get("winner")
    result_type = outcome.get("result") if "result" in outcome else ("win" if winner else None)
    toss = info.get("toss", {})
    teams = info.get("teams", [])

    def pid(n):
        return reg.get(n) if n else None

    dels, innings_runs = [], {}
    for inn_no, inn in enumerate(raw.get("innings", []), start=1):
        bat = inn.get("team")
        bowl = next((t for t in teams if t != bat), None)
        tot = 0
        for over in inn.get("overs", []):
            on = over["over"]; ph = phase_for(fmt, on)
            for b, d in enumerate(over.get("deliveries", [])):
                r = d["runs"]; ex = d.get("extras", {})
                et = next(iter(ex), None) if ex else None
                wk = d.get("wickets")
                tot += r.get("total", r["batter"] + r.get("extras", 0))
                dels.append(Delivery(inn_no, on, b + 1, pid(d["batter"]), pid(d.get("non_striker")),
                                     pid(d["bowler"]), r["batter"], r.get("extras", 0), et,
                                     wk[0]["kind"] if wk else None,
                                     pid(wk[0].get("player_out")) if wk else None,
                                     ph, bat, bowl))
        innings_runs[inn_no] = tot

    if fmt in LIMITED:
        bpi = 120 if fmt == "t20" else 300
        for inn_no in set(d.innings_no for d in dels):
            if inn_no < 2:
                continue
            target = innings_runs.get(inn_no - 1, 0) + 1
            legal = scored = 0
            for d in [x for x in dels if x.innings_no == inn_no]:
                d.target = target; d.runs_required = max(target - scored, 0)
                d.balls_remaining = max(bpi - legal, 0)
                if d.extra_type not in ("wides", "noballs"):
                    legal += 1
                scored += d.runs_batter + d.runs_extras

    m = Match(match_id, fmt, info.get("gender"), league_canon(ev_name),
              (info.get("dates") or [None])[0], info.get("venue"), info.get("city"),
              teams, toss.get("winner"), toss.get("decision"), winner, result_type,
              stage, is_ko, dels, innings_runs)
    m.team_type = team_type
    return m


def ingest_zip(zip_path, db="cil.db", start=0, count=None):
    conn = connect(db)
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA temp_store=MEMORY")
    if start == 0:
        reset(conn)
    z = zipfile.ZipFile(zip_path)
    members = sorted(n for n in z.namelist()
                     if n.endswith(".json") and not n.endswith("_info.json"))
    end = len(members) if count is None else min(len(members), start + count)
    n_match = n_del = n_skip = 0
    players = {}
    t0 = time.time()
    for idx in range(start, end):
        name = members[idx]
        try:
            raw = orjson.loads(z.read(name))
            info = raw.get("info", {})
            if info.get("gender") not in ("male", "female"):
                continue
            if not raw.get("innings"):
                continue
            mid = name.rsplit("/", 1)[-1].rsplit(".", 1)[0]
            m = parse_dict(raw, mid)
            if m.fmt not in ("t20", "odi", "test"):
                continue
        except Exception:
            n_skip += 1
            continue
        for nm, pid in info.get("registry", {}).get("people", {}).items():
            players[pid] = nm
        conn.execute("INSERT OR REPLACE INTO dim_match VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                     (m.match_id, m.fmt, getattr(m, "team_type", None), m.gender, m.league,
                      m.date, m.venue, m.city,
                      (m.teams + [None, None])[0], (m.teams + [None, None])[1],
                      m.toss_winner, m.toss_decision, m.winner, m.result_type, m.stage, int(m.is_knockout)))
        for inn_no, runs in m.innings_runs.items():
            bt = next((d.batting_team for d in m.deliveries if d.innings_no == inn_no), None)
            conn.execute("INSERT INTO fact_innings VALUES (?,?,?,?)", (m.match_id, inn_no, bt, runs))
        won = m.winner
        rows = []
        for d in m.deliveries:
            is_win = 1 if (won and d.batting_team == won) else (0 if won else None)
            rows.append((m.match_id, d.innings_no, d.over_no, d.ball_in_over, d.batter_id,
                         d.non_striker_id, d.bowler_id, d.runs_batter, d.runs_extras, d.extra_type,
                         d.wicket_kind, d.player_out_id, d.phase, d.batting_team, d.bowling_team,
                         d.target, d.runs_required, d.balls_remaining, is_win,
                         1 if d.innings_no >= 2 else 0, int(m.is_knockout)))
        conn.executemany("INSERT INTO fact_delivery VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        n_match += 1; n_del += len(rows)
        if n_match % 500 == 0:
            conn.commit()
    for pid, nm in players.items():
        conn.execute("INSERT OR REPLACE INTO dim_player(player_id,name) VALUES (?,?)", (pid, nm))
    conn.commit(); conn.close()
    return {"scanned": end - start, "matches": n_match, "deliveries": n_del,
            "skipped": n_skip, "players_seen": len(players), "next_start": end,
            "total_members": len(members), "secs": round(time.time() - t0, 1)}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", required=True)
    ap.add_argument("--db", default="cil.db")
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--count", type=int, default=None)
    a = ap.parse_args()
    print(ingest_zip(a.zip, a.db, a.start, a.count))
