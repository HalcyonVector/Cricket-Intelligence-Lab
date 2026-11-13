"""Cross-check every built data file against every other, for every competition and player.

Catches "panel shows the wrong scope or partial data" bugs: a per-competition number that is
really all-competitions, season totals that don't add up to the career line, filtered numbers
larger than unfiltered ones, and so on. Run on built data (python scripts/fetch_data.py, or after
scripts/build_all.py):

    python tests/data_consistency.py [dashboard dir]   # exit 1 on any failure
"""
from __future__ import annotations
import json, os, re, sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DASH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "web", "dashboard")   # optional: another built folder
fails, checks = [], defaultdict(int)


def js(path, wrapper=None):
    """Load window.__x("key",{...}); or window.X={...}; files."""
    if not os.path.exists(path):
        return None
    t = open(path, encoding="utf-8").read()
    if t.lstrip().startswith("window.__"):
        args = t.index("(") + 1
        if t[args] == "{":                      # window.__x({...});
            return json.JSONDecoder().raw_decode(t, args)[0]
        return json.JSONDecoder().raw_decode(t, t.index(",", args) + 1)[0]   # window.__x("key",{...});
    return json.JSONDecoder().raw_decode(t, t.index("=") + 1)[0]


def check(name, ok, detail=""):
    checks[name] += 1
    if not ok and len([f for f in fails if f[0] == name]) < 5:
        fails.append((name, detail))
    elif not ok:
        fails.append((name, None))


def main():
    index = js(os.path.join(DASH, "index.js"))
    keys = [c["key"] for c in index["cohorts"]]
    # full-members-only bundles (<key>__fm) for international competitions, when built
    fm_keys = [k + "__fm" for k in keys if os.path.exists(os.path.join(DASH, "cohorts", f"{k}__fm.js"))]
    players_ix = js(os.path.join(DASH, "players.js")) or {"k": [], "p": {}}
    pos = {k: i for i, k in enumerate(players_ix["k"])}
    careers, cvenues = {}, {}
    for f in os.listdir(os.path.join(DASH, "careers")):
        d = js(os.path.join(DASH, "careers", f))
        careers.update(d["c"]); cvenues.update(d["v"])
    # all-competitions runs per player = sum over the cohorts in the players index
    all_runs = {pid: sum(r[1] for r in e[1]) for pid, e in players_ix["p"].items()}

    for key in keys + fm_keys:
        core = js(os.path.join(DASH, "cohorts", f"{key}.js"))
        det = js(os.path.join(DASH, "cohorts", "d", f"{key}.js")) or {"players": {}, "bowlers": {}}
        x = js(os.path.join(DASH, "cohorts", "x", f"{key}.js"))
        mu = js(os.path.join(DASH, "cohorts", "matchups", f"{key}.js"))
        P, B, fmt = core["players"], core["bowlers"], core["meta"]["format"]
        tag = lambda pid, what: f"{key} {P.get(pid, B.get(pid, {})).get('name', pid)}: {what}"

        # season rows (time window, form charts, milestones) add up to the competition totals
        if x:
            pid_of = [p[0] for p in x["p"]]
            sb, sw = defaultdict(lambda: [0, 0, 0]), defaultdict(lambda: [0, 0, 0])
            for r in x["yb"]:
                a = sb[pid_of[r[0]]]; a[0] += r[2]; a[1] += r[3]; a[2] += r[5]
            for r in x["yw"]:
                a = sw[pid_of[r[0]]]; a[0] += r[2]; a[1] += r[3]; a[2] += r[4]
            for pid, p in P.items():
                s = sb.get(pid, [0, 0, 0])
                check("season batting = competition totals", (s[0], s[1]) == (p["balls"], p["runs"]),
                      tag(pid, f"seasons {s[0]}b/{s[1]}r vs {p['balls']}b/{p['runs']}r"))
                check("season innings = competition innings", s[2] == p.get("innings", s[2]), tag(pid, f"{s[2]} vs {p.get('innings')}"))
            for pid, b in B.items():
                s = sw.get(pid, [0, 0, 0])
                check("season bowling = competition totals", (s[0], s[2]) == (b["balls"], b["wickets"]),
                      tag(pid, f"seasons {s[0]}b/{s[2]}w vs {b['balls']}b/{b['wickets']}w"))
            # full-members-only can never exceed all matches
            if x.get("fm"):
                fb = defaultdict(lambda: [0, 0])
                for r in x["fm"]["yb"]:
                    a = fb[pid_of[r[0]]]; a[0] += r[2]; a[1] += r[3]
                for pid, (bl, rn) in fb.items():
                    p = P.get(pid, {"balls": 0, "runs": 0})
                    check("full-members totals <= all matches", bl <= p["balls"] and rn <= p["runs"], tag(pid, f"fm {rn}r > {p['runs']}r"))
                for r in x["fm"].get("adv", []):
                    p = P.get(pid_of[r[0]], {"runs": 0})
                    check("full-members clutch/collapse inputs <= totals", r[4] <= r[2] and r[6] <= r[2] and r[2] <= p["runs"], tag(pid_of[r[0]], str(r)))
            # last-30-days performances are real innings of real players
            if x.get("week"):
                for r in x["week"]["innings"]:
                    p = P.get(pid_of[r[0]], {"runs": 0})
                    check("latest innings <= career runs", r[1] <= p["runs"], tag(pid_of[r[0]], f"{r[1]} > {p['runs']}"))
            # venue pages: top batters at a ground never exceed their competition runs
            for v, d in x.get("venues", {}).items():
                for r in d["bat"]:
                    p = P.get(pid_of[r[0]], {"runs": 0})
                    check("venue page runs <= competition runs", r[1] <= p["runs"], f"{key} {v}: {pid_of[r[0]]} {r[1]} > {p['runs']}")

        for pid, d in det["players"].items():
            p = P.get(pid)
            check("detail players exist in the bundle", p is not None, f"{key} {pid}")
            if not p:
                continue
            # profile By venue (this competition) is a subset of the competition totals
            vs = d.get("venues") or []
            check("venue runs <= competition runs", sum(v["runs"] for v in vs) <= p["runs"], tag(pid, f"venues {sum(v['runs'] for v in vs)} > {p['runs']}"))
            # phases partition the innings (limited overs)
            if fmt != "test" and d.get("phases"):
                pb = sum(v["balls"] for v in d["phases"].values())
                check("phase balls <= total balls", pb <= p["balls"], tag(pid, f"phases {pb} > {p['balls']}"))
                if p["balls"] >= 120:
                    check("phase balls cover the innings", pb >= 0.97 * p["balls"], tag(pid, f"phases {pb} of {p['balls']}"))
            if fmt == "test":
                check("tests carry no powerplay/death phases", not set((d.get("phases") or {})) - {"middle"}, tag(pid, str(d.get("phases"))))
            # all-competitions venue list must be at least the per-competition one at each ground
            allv = {v["venue"]: v["runs"] for v in cvenues.get(pid, [])}
            for v in vs:
                if v["venue"] in allv:
                    check("all-competitions venue runs >= competition venue runs", allv[v["venue"]] >= v["runs"], tag(pid, f"{v['venue']}: all {allv[v['venue']]} < comp {v['runs']}"))

        # matchups: a batter's pairs never exceed their totals; every pair's batter is in the bundle
        if mu:
            mb = defaultdict(lambda: [0, 0])
            for r in mu["rows"]:
                pid = mu["bat"][r[0]][0]; mb[pid][0] += r[2]; mb[pid][1] += r[3]
            for pid, (bl, rn) in mb.items():
                p = P.get(pid)
                check("matchup batters exist in the bundle", p is not None, f"{key} {pid}")
                if p:
                    check("matchup balls/runs <= totals", bl <= p["balls"] and rn <= p["runs"], tag(pid, f"matchups {bl}b/{rn}r vs {p['balls']}b/{p['runs']}r"))

        # cross-competition index (search, "Also played in") matches this bundle
        if key in pos:
            for pid, p in P.items():
                e = players_ix["p"].get(pid)
                row = next((r for r in (e[1] if e else []) if r[0] == pos[key]), None)
                check("players index runs = bundle runs", row is not None and row[1] == p["runs"], tag(pid, f"index {row} vs {p['runs']}"))
                # all-competitions totals can never be below one competition's
                check("all-competitions runs >= competition runs", all_runs.get(pid, 0) >= p["runs"], tag(pid, f"{all_runs.get(pid)} < {p['runs']}"))
        # records agree with the bundle they summarise
        mr = (core.get("records") or {}).get("most_runs") or []
        if mr and P:
            check("most-runs record = top scorer", mr[0]["value"] == max(p["runs"] for p in P.values()), f"{key}: {mr[0]} vs {max(p['runs'] for p in P.values())}")

    # a full-members bundle is a subset of its competition: never more runs, balls or wickets
    for fk in fm_keys:
        base = js(os.path.join(DASH, "cohorts", f"{fk[:-4]}.js")); f = js(os.path.join(DASH, "cohorts", f"{fk}.js"))
        check("full-members bundle flagged", f["meta"].get("fm") is True, fk)
        # <= not <: some competitions (e.g. women's Tests) are played only between full members
        check("full-members matches <= all matches", f["meta"]["matches"] <= base["meta"]["matches"], fk)
        for pid, p in f["players"].items():
            q = base["players"].get(pid)
            check("full-members batting <= all matches", q is not None and p["runs"] <= q["runs"] and p["balls"] <= q["balls"], f"{fk} {p.get('name')}")
        for pid, p in f["bowlers"].items():
            q = base["bowlers"].get(pid)
            check("full-members bowling <= all matches", q is not None and p["wickets"] <= q["wickets"] and p["balls"] <= q["balls"], f"{fk} {p.get('name')}")

    # all-competitions season chart (careers) is never below one competition's season
    for key in keys + fm_keys:
        x = js(os.path.join(DASH, "cohorts", "x", f"{key}.js"))
        if not x:
            continue
        pid_of = [p[0] for p in x["p"]]
        for r in x["yb"]:
            pid, yr, runs = pid_of[r[0]], r[1], r[3]
            cy = {y["year"]: y["runs"] for y in careers.get(pid, [])}
            if yr in cy:
                check("all-competitions season runs >= competition season runs", cy[yr] >= runs, f"{key} {pid} {yr}: all {cy[yr]} < comp {runs}")

    # Trends page and rolling-form chart (skipped for data built before they existed)
    for key in keys + fm_keys:
        core = js(os.path.join(DASH, "cohorts", f"{key}.js"))
        x = js(os.path.join(DASH, "cohorts", "x", f"{key}.js"))
        if x and x.get("trend"):
            C = x["trend_cols"]; T = [dict(zip(C, r)) for r in x["trend"]]
            check("trend matches add up to the competition", sum(r["matches"] for r in T) == core["meta"]["matches"],
                  f"{key}: {sum(r['matches'] for r in T)} vs {core['meta']['matches']}")
            yw_balls = defaultdict(int)
            for r in x["yw"]:
                yw_balls[r[1]] += r[2]
            for r in T:
                check("trend balls = sum of bowlers' balls that season", r["balls"] == yw_balls.get(r["yr"], 0), f"{key} {r['yr']}")
                check("trend phase balls <= season balls", r["pp_balls"] + r["mid_balls"] + r["death_balls"] <= r["balls"], f"{key} {r['yr']}")
                check("trend decided <= matches and wins <= decided", r["decided"] <= r["matches"] and r["bat2_won"] <= r["decided"]
                      and r["toss_won"] <= r["decided"], f"{key} {r['yr']}")
        fdir = os.path.join(DASH, "cohorts", "f", key)
        if not os.path.isdir(fdir):
            continue
        for fn in os.listdir(fdir):
            d = js(os.path.join(fdir, fn))
            for pid, rows in d["b"].items():
                p = core["players"].get(pid)
                check("innings log runs and balls = player totals", p is not None and sum(r[1] for r in rows) == p["runs"]
                      and sum(r[2] for r in rows) == p["balls"], f"{key} {pid}")
            for pid, rows in d["w"].items():
                b = core["bowlers"].get(pid)
                check("innings log wickets and balls = bowler totals", b is not None and sum(r[3] for r in rows) == b["wickets"]
                      and sum(r[1] for r in rows) == b["balls"], f"{key} {pid}")

    total = sum(checks.values())
    for name, n in sorted(checks.items()):
        bad = sum(1 for f in fails if f[0] == name)
        print(f"{'FAIL' if bad else 'ok  '} {name}: {n:,} checks" + (f", {bad} failed" if bad else ""))
    for name, d in fails:
        if d:
            print(f"   - {name}: {d}")
    print(f"{total:,} checks across {len(keys)} competitions and {len(fm_keys)} full-member versions, {len(fails)} failed")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
