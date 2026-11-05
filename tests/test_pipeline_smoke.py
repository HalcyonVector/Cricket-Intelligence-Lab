"""End-to-end smoke test: synthetic Cricsheet zip -> ingest -> full build -> every output file.

Small enough to run in CI in a few seconds, but it exercises the same code paths as the
weekly rebuild (cohort bundles, matchups, extras, career shards, players index).
"""
import json, os, random, sys, tempfile, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "packages", "etl"))
sys.path.insert(0, os.path.join(ROOT, "packages", "analytics"))

# three ICC full members + one associate, so the "full members only" scope is exercised
TEAMS = {t: [f"{t[:3]} P{i}" for i in range(11)] for t in ("India", "Australia", "England", "Nepal")}


def _pid(name):
    return format(abs(hash(("cil-test", name))) % (16 ** 8), "08x")


def _innings(rng, bat, bowl, target=None):
    overs, runs, wk, striker, ns, nxt = [], 0, 0, 0, 1, 2
    for o in range(20):
        dels = []
        bowler = bowl[6 + o % 5]
        for _ in range(6):
            r = rng.choice([0, 0, 1, 1, 1, 2, 4, 6])
            d = {"batter": bat[striker], "bowler": bowler, "non_striker": bat[ns],
                 "runs": {"batter": r, "extras": 0, "total": r}}
            if rng.random() < 0.05 and wk < 9:
                d["runs"] = {"batter": 0, "extras": 0, "total": 0}
                d["wickets"] = [{"kind": "bowled", "player_out": bat[striker]}]
                wk += 1; striker = nxt; nxt += 1
            else:
                runs += r
                if r % 2:
                    striker, ns = ns, striker
            dels.append(d)
            if target and runs >= target:
                break
        overs.append({"over": o, "deliveries": dels})
        striker, ns = ns, striker
        if target and runs >= target:
            break
    return {"overs": overs}, runs


def make_zip(path, n=24):
    rng = random.Random(7)
    names = list(TEAMS)
    with zipfile.ZipFile(path, "w") as z:
        for i in range(n):
            a, b = rng.sample(names, 2)
            i1, r1 = _innings(rng, TEAMS[a], TEAMS[b])
            i2, r2 = _innings(rng, TEAMS[b], TEAMS[a], target=r1 + 1)
            i1["team"], i2["team"] = a, b
            reg = {p: _pid(p) for t in (a, b) for p in TEAMS[t]}
            m = {"meta": {"data_version": "1.1.0"},
                 "info": {"match_type": "T20", "gender": "male", "team_type": "international",
                          "dates": [f"{2019 + i % 6}-0{1 + i % 9}-1{i % 9}"], "teams": [a, b],
                          "venue": f"Ground {i % 3}, City {i % 3}", "city": f"City {i % 3}",
                          "toss": {"winner": a, "decision": "bat"},
                          "outcome": {"winner": b if r2 > r1 else a},
                          "registry": {"people": reg}},
                 "innings": [i1, i2]}
            z.writestr(f"{1000 + i}.json", json.dumps(m))


def test_full_build():
    from cil_etl.ingest_zip import ingest_zip
    from cil_analytics.pipeline import build
    with tempfile.TemporaryDirectory() as d:
        zp, db = os.path.join(d, "all.zip"), os.path.join(d, "cil.db")
        make_zip(zp)
        info = ingest_zip(zp, db)
        assert info["matches"] == 24
        dash = os.path.join(d, "dashboard"); cohorts = os.path.join(dash, "cohorts")
        idx = build(db, os.path.join(d, "data"), cohorts)
        keys = [c["key"] for c in idx["cohorts"]]
        assert "t20i_men" in keys
        load = lambda p: json.loads(open(p, encoding="utf-8").read().split(",", 1)[1].rsplit(")", 1)[0])
        b = load(os.path.join(cohorts, "t20i_men.js"))
        assert b["players"] and b["bowlers"]
        assert "_matchups_all" not in b
        assert any(v.get("archetype") for v in b["bowlers"].values()), "bowler archetypes missing"
        assert any("context" in v for v in b["bowlers"].values()), "bowler context splits missing"
        x = load(os.path.join(cohorts, "x", "t20i_men.js"))
        for k in ("yb", "yw", "venues", "teams", "recent", "week", "p"):
            assert k in x, k
        assert x["yb"] and x["recent"] and x["teams"]
        assert {r[1] for r in x["yb"]} >= {2019, 2024}
        fm = x["fm"]
        assert fm["yb"] and fm["yw"] and fm["wp"] and "mu" in fm
        assert len(fm["yb"]) < len(x["yb"]), "full-member scope should drop the associate's matches"
        assert x["bp"] and x["wp"]
        assert os.path.exists(os.path.join(cohorts, "matchups", "t20i_men.js"))
        assert len(os.listdir(os.path.join(dash, "careers"))) == 16
        players = json.loads(open(os.path.join(dash, "players.js"), encoding="utf-8").read()[len("window.__playersLoaded("):-2])
        assert players["k"] == keys and players["p"]


if __name__ == "__main__":
    test_full_build(); print("pipeline smoke test OK")
