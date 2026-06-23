"""Parse Cricsheet match JSON into normalized rows + match context.

Cricsheet structure: {meta, info, innings:[{team, overs:[{over, deliveries:[...]}]}]}.
Players are resolved via info.registry.people (name -> stable 8-hex id). We NEVER key
on display names. Standard Cricsheet files do NOT carry batting hand or bowling style,
so those are left NULL and can be enriched later from a player-attributes source.
"""
from __future__ import annotations

import orjson
from dataclasses import dataclass

# Format-aware powerplay / middle / death boundaries by over index (0-based start).
PHASE_BANDS = {
    "t20": (6, 16), "t20i": (6, 16), "it20": (6, 16),
    "odi": (10, 40), "odm": (10, 40),
}


def phase_for(fmt: str, over_no: int) -> str:
    bands = PHASE_BANDS.get(fmt)
    if not bands:                       # Tests / unknown: single bucket
        return "middle"
    pp_end, mid_end = bands
    if over_no < pp_end:
        return "powerplay"
    if over_no < mid_end:
        return "middle"
    return "death"


NON_BOWLER_WICKETS = {"run out", "retired hurt", "retired out", "obstructing the field",
                      "timed out", "handled the ball"}


@dataclass
class Delivery:
    innings_no: int
    over_no: int
    ball_in_over: int
    batter_id: str
    non_striker_id: str | None
    bowler_id: str
    runs_batter: int
    runs_extras: int
    extra_type: str | None
    wicket_kind: str | None
    player_out_id: str | None
    phase: str
    batting_team: str
    bowling_team: str
    target: int | None = None
    runs_required: int | None = None
    balls_remaining: int | None = None


@dataclass
class Match:
    match_id: str
    fmt: str
    gender: str | None
    league: str | None
    date: str | None
    venue: str | None
    city: str | None
    teams: list
    toss_winner: str | None
    toss_decision: str | None
    winner: str | None
    result_type: str | None
    stage: str | None
    is_knockout: bool
    deliveries: list
    innings_runs: dict


_KNOCKOUT_WORDS = ("final", "qualifier", "eliminator", "semi", "playoff", "knockout")


def _pid(reg, name):
    return reg.get(name) if name else None


def parse_match(path: str) -> Match:
    raw = orjson.loads(open(path, "rb").read())
    info = raw["info"]
    reg = info.get("registry", {}).get("people", {})
    match_id = path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    fmt = (info.get("match_type") or "").lower()

    event = info.get("event") or {}
    stage = event.get("stage") if isinstance(event, dict) else None
    is_knockout = bool(stage) and any(w in str(stage).lower() for w in _KNOCKOUT_WORDS)

    outcome = info.get("outcome", {})
    winner = outcome.get("winner")
    if "result" in outcome:
        result_type = outcome["result"]
    elif winner:
        result_type = "win"
    else:
        result_type = None

    toss = info.get("toss", {})
    teams = info.get("teams", [])

    deliveries = []
    innings_runs = {}

    for inn_no, inn in enumerate(raw.get("innings", []), start=1):
        bat_team = inn.get("team")
        bowl_team = next((t for t in teams if t != bat_team), None)
        run_total = 0
        for over in inn.get("overs", []):
            over_no = over["over"]
            ph = phase_for(fmt, over_no)
            for b, d in enumerate(over.get("deliveries", [])):
                runs = d["runs"]
                extras = d.get("extras", {})
                etype = next(iter(extras), None) if extras else None
                wk = d.get("wickets")
                wkind = wk[0]["kind"] if wk else None
                pout = _pid(reg, wk[0].get("player_out")) if wk else None
                run_total += runs.get("total", runs["batter"] + runs.get("extras", 0))
                deliveries.append(Delivery(
                    innings_no=inn_no, over_no=over_no, ball_in_over=b + 1,
                    batter_id=_pid(reg, d["batter"]), non_striker_id=_pid(reg, d.get("non_striker")),
                    bowler_id=_pid(reg, d["bowler"]),
                    runs_batter=runs["batter"], runs_extras=runs.get("extras", 0),
                    extra_type=etype, wicket_kind=wkind, player_out_id=pout, phase=ph,
                    batting_team=bat_team, bowling_team=bowl_team,
                ))
        innings_runs[inn_no] = run_total

    if fmt in PHASE_BANDS:
        balls_per_innings = 120 if fmt in ("t20", "t20i", "it20") else 300
        for inn_no in set(d.innings_no for d in deliveries):
            if inn_no < 2:
                continue
            target = innings_runs.get(inn_no - 1, 0) + 1
            legal = 0
            scored = 0
            for d in [x for x in deliveries if x.innings_no == inn_no]:
                d.target = target
                d.runs_required = max(target - scored, 0)
                d.balls_remaining = max(balls_per_innings - legal, 0)
                if d.extra_type not in ("wides", "noballs"):
                    legal += 1
                scored += d.runs_batter + d.runs_extras

    return Match(
        match_id=match_id, fmt=fmt, gender=info.get("gender"),
        league=(event.get("name") if isinstance(event, dict) else None),
        date=(info.get("dates") or [None])[0],
        venue=info.get("venue"), city=info.get("city"),
        teams=teams, toss_winner=toss.get("winner"),
        toss_decision=toss.get("decision"), winner=winner, result_type=result_type,
        stage=stage, is_knockout=is_knockout,
        deliveries=deliveries, innings_runs=innings_runs,
    )
