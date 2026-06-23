#!/usr/bin/env python3
"""Local app server for Cricket Intelligence Lab.

Live data + player profiles backed by Cricbuzz. Cricbuzz is a Next.js app whose
pages inline their data as JSON inside the streaming payload
(self.__next_f.push([...])), so a plain `requests` GET + JSON extraction yields
clean, structured data - no headless browser, no API key, no Akamai.

    GET /api/live                       -> matches in progress
    GET /api/schedule                   -> upcoming fixtures
    GET /api/results                    -> recently completed matches
    GET /api/match?id=<cricbuzz match id> -> detail for one match
    GET /api/player?name=Virat Kohli    -> profile: bio, rankings, batting/bowling stats
        /api/player?url=<cricbuzz profile url>   (exact, skips name lookup)
        /api/player?id=<cricbuzz id>
    GET /api/photo?name=Virat Kohli     -> 302 to that player's headshot
    GET /api/_debug                     -> parser diagnostics

SETUP (once):
    pip install requests
    # optional, only improves player name->profile lookup if Cricbuzz search misses:
    pip install googlesearch-python

RUN:
    python serve.py            # then open http://127.0.0.1:5000
"""
from __future__ import annotations
import json, os, re, threading, time, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web", "dashboard")
CACHE = os.path.join(ROOT, ".cache")
os.makedirs(CACHE, exist_ok=True)
PORT = int(os.environ.get("PORT", "5000"))

CB_LIVE = "https://www.cricbuzz.com/cricket-match/live-scores"
CB_SCHEDULE = "https://www.cricbuzz.com/cricket-schedule/upcoming-series/international"
CB_RESULTS = "https://www.cricbuzz.com/cricket-match/live-scores/recent-matches"
CB_SEARCH = "https://www.cricbuzz.com/search?q={q}"
CB_PROFILE = "https://www.cricbuzz.com/profiles/{cid}/x"
CB_MATCH = "https://www.cricbuzz.com/live-cricket-scores/{mid}"
CB_SCORECARD = "https://www.cricbuzz.com/live-cricket-scorecard/{mid}/{slug}"
CB_SQUADS_URL = "https://www.cricbuzz.com/cricket-match-squads/{mid}/{slug}"
CB_COMMENTARY = "https://www.cricbuzz.com/live-cricket-scores/{mid}/{slug}"
CB_FULLCOMM = "https://www.cricbuzz.com/live-cricket-full-commentary/{mid}/{slug}"
CB_FACTS = "https://www.cricbuzz.com/cricket-match-facts/{mid}/{slug}"
DB = os.path.join(ROOT, "cil.db")  # ball-by-ball SQLite, present after build_all.py
_BUILD_LOCK = os.path.join(ROOT, ".build.lock")


def _db_ready():
    """True only when cil.db exists and no build is mid-swap (build_all.py holds .build.lock)."""
    return os.path.isfile(DB) and not os.path.exists(_BUILD_LOCK)
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}

LIVE_STATES = {"in progress", "innings break", "toss", "rain", "delay", "lunch",
               "tea", "stumps", "drinks", "live"}
UPCOMING_STATES = {"preview", "upcoming"}

_mem: dict = {}
_lock = threading.Lock()


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def cached(key, ttl, fn):
    now = time.time()
    with _lock:
        v = _mem.get(key)
        if v and v[0] > now:
            return v[1]
    data = fn()
    with _lock:
        _mem[key] = (now + ttl, data)
    return data


# ---------- Cricbuzz Next.js payload extraction ----------
def _http_get(url):
    import requests
    r = requests.get(url, headers=HEADERS, timeout=30, allow_redirects=True)
    r.raise_for_status()
    return r.text


def _decode_next_stream(html):
    """Concatenate + unescape every self.__next_f.push([_, "<chunk>"]) string."""
    out, key, i = [], "self.__next_f.push(", 0
    while True:
        j = html.find(key, i)
        if j < 0:
            break
        k = j + len(key)
        depth, end, instr, esc = 0, k, False, False
        while end < len(html):
            c = html[end]
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                instr = not instr
            elif not instr:
                if c == "(":
                    depth += 1
                elif c == ")":
                    if depth == 0:
                        break
                    depth -= 1
            end += 1
        try:
            a = json.loads(html[k:end])
            if isinstance(a, list) and len(a) > 1 and isinstance(a[1], str):
                out.append(a[1])
        except Exception:
            pass
        i = end + 1
    return "".join(out)


def _scan_balanced(s, j):
    """From index j (which must point at '{'), return the balanced {...} substring."""
    depth, instr, esc, k = 0, False, False, j
    while k < len(s):
        c = s[k]
        if esc:
            esc = False
        elif c == "\\":
            esc = True
        elif c == '"':
            instr = not instr
        elif not instr:
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return s[j:k + 1]
        k += 1
    return None


def _balanced_objects(s, start_key):
    res = []
    for m in re.finditer(re.escape(start_key), s):
        obj = _scan_balanced(s, m.start())
        if obj:
            res.append(obj)
    return res


def _object_after(s, key):
    """The balanced object that is the VALUE following `key` (e.g. '\"playerData\":')."""
    i = s.find(key)
    if i < 0:
        return None
    j = s.find("{", i)
    return _scan_balanced(s, j) if j >= 0 else None


def _matches_from_html(html):
    stream = _decode_next_stream(html)
    slugmap = {}
    for i, sl in re.findall(r"/live-cricket-scores/(\d+)/([a-z0-9-]+)", html):
        slugmap.setdefault(i, sl)
    seen = {}
    for raw in _balanced_objects(stream, '{"matchInfo":'):
        try:
            d = json.loads(raw)
        except Exception:
            continue
        mi = d.get("matchInfo") or {}
        mid = mi.get("matchId")
        if mid is not None:
            d["slug"] = slugmap.get(str(mid)) or ""
            seen[mid] = d
    return list(seen.values())


def _fetch_matches(url):
    return _matches_from_html(_http_get(url))


# ---------- match shaping ----------
def _innings_str(team_score):
    if not isinstance(team_score, dict):
        return ""
    parts = []
    for k in sorted(team_score.keys()):
        inn = team_score[k]
        if not isinstance(inn, dict):
            continue
        r, w, o = inn.get("runs"), inn.get("wickets"), inn.get("overs")
        if r is None:
            continue
        w = 0 if w is None else w
        seg = f"{r}/{w}"
        if o is not None:
            seg += f" ({o})"
        parts.append(seg)
    return " & ".join(parts)


def _team(mi, n):
    t = mi.get(f"team{n}") or {}
    return t.get("teamName") or t.get("teamSName") or ""


def _venue(mi):
    v = mi.get("venueInfo") or {}
    return ", ".join(x for x in (v.get("ground"), v.get("city")) if x)


def _epoch_dt(mi):
    ms = mi.get("startDate")
    try:
        ms = int(ms)
    except Exception:
        return "", ""
    off = 0
    tz = (mi.get("venueInfo") or {}).get("timezone") or ""
    m = re.match(r"^([+-])(\d{2}):?(\d{2})$", tz)
    if m:
        sign = 1 if m.group(1) == "+" else -1
        off = sign * (int(m.group(2)) * 3600 + int(m.group(3)) * 60)
    t = time.gmtime(ms / 1000 + off)
    return time.strftime("%Y-%m-%d", t), time.strftime("%H:%M", t)


def _fmt_match(d):
    mi = d.get("matchInfo") or {}
    ms = d.get("matchScore") or {}
    teams = [{"name": _team(mi, 1), "score": _innings_str(ms.get("team1Score"))},
             {"name": _team(mi, 2), "score": _innings_str(ms.get("team2Score"))}]
    desc = mi.get("matchDesc") or ""
    title = " vs ".join(t["name"] for t in teams if t["name"])
    if desc:
        title = f"{title} - {desc}" if title else desc
    return {"id": mi.get("matchId"), "slug": d.get("slug") or "", "series": mi.get("seriesName") or "", "title": title,
            "status": mi.get("status") or mi.get("stateTitle") or mi.get("state") or "",
            "state": mi.get("state") or "", "format": mi.get("matchFormat") or "",
            "venue": _venue(mi), "teams": teams, "note": mi.get("shortStatus") or ""}


def _fmt_sched(d):
    mi = d.get("matchInfo") or {}
    f = _fmt_match(d)
    date, tm = _epoch_dt(mi)
    return {"date": date, "time": tm, "title": f["title"], "series": f["series"],
            "venue": _venue(mi)}


def _state(d):
    return str((d.get("matchInfo") or {}).get("state") or "").lower()


def get_live():
    ms = cached("live", 25, lambda: _fetch_matches(CB_LIVE))
    return {"generated": _now(), "matches": [_fmt_match(d) for d in ms if _state(d) in LIVE_STATES]}


def get_schedule():
    def build():
        seen = {}
        for url in (CB_SCHEDULE, CB_LIVE):
            try:
                for d in _fetch_matches(url):
                    mid = (d.get("matchInfo") or {}).get("matchId")
                    if mid is not None:
                        seen[mid] = d
            except Exception:
                pass
        return list(seen.values())
    ms = cached("schedule", 60, build)
    out = [_fmt_sched(d) for d in ms if _state(d) in UPCOMING_STATES]
    out.sort(key=lambda x: (x.get("date") or "9999", x.get("time") or ""))
    return {"generated": _now(), "matches": out}


def get_results():
    def build():
        for url in (CB_RESULTS, CB_LIVE):
            try:
                return _fetch_matches(url)
            except Exception:
                continue
        return []
    ms = cached("results", 120, build)
    return {"generated": _now(),
            "matches": [_fmt_match(d) for d in ms if _state(d) in ("complete", "abandon")]}


def get_match(mid, slug=None):
    """Detail for one match: summary + full scorecard (innings/batting/bowling) + playing XIs."""
    def build():
        m = None
        for url in (CB_LIVE, CB_RESULTS, CB_MATCH.format(mid=mid)):
            try:
                for d in _fetch_matches(url):
                    if str((d.get("matchInfo") or {}).get("matchId")) == str(mid):
                        m = _fmt_match(d)
                        mi = d.get("matchInfo") or {}
                        toss = mi.get("tossResults") or {}
                        if isinstance(toss, dict):
                            tw = toss.get("tossWinnerName") or ""
                            dec = toss.get("decision") or ""
                            m["toss"] = f"{tw} opt to {dec}".strip() if tw else ""
                        else:
                            m["toss"] = str(toss)
                        m["date"], m["time"] = _epoch_dt(mi)
                        break
                if m:
                    break
            except Exception:
                continue
        if not m:
            m = {"id": mid}
        sl = slug or m.get("slug") or "x"
        try:
            m["innings"] = _parse_scorecard(_http_get(CB_SCORECARD.format(mid=mid, slug=sl)))
        except Exception:
            m["innings"] = []
        try:
            m["squads"] = _parse_squads(_http_get(CB_SQUADS_URL.format(mid=mid, slug=sl)))
        except Exception:
            m["squads"] = []
        return m
    return cached(f"match:{mid}:{slug or ''}", 25, build)


def get_career(pid):
    """Per-year batting line for one player, queried live from cil.db (all formats in coverage)."""
    if not _db_ready():
        return None
    def build():
        import sqlite3
        con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
        q = """SELECT substr(m.match_date,1,4) AS yr,
                 SUM(d.runs_batter) AS runs,
                 SUM(CASE WHEN d.extra_type IS NULL OR d.extra_type<>'wides' THEN 1 ELSE 0 END) AS balls,
                 COUNT(DISTINCT d.match_id || '-' || d.innings_no) AS inns,
                 SUM(CASE WHEN d.player_out_id=d.batter_id THEN 1 ELSE 0 END) AS outs
               FROM fact_delivery d JOIN dim_match m ON d.match_id=m.match_id
               WHERE d.batter_id=? AND m.match_date IS NOT NULL
               GROUP BY yr HAVING balls>0 ORDER BY yr"""
        try:
            rows = con.execute(q, (pid,)).fetchall()
        finally:
            con.close()
        years = []
        for r in rows:
            yr = r["yr"]
            if not yr or not str(yr).isdigit():
                continue
            runs, balls, outs, inns = (r["runs"] or 0), (r["balls"] or 0), (r["outs"] or 0), (r["inns"] or 0)
            years.append({"year": int(yr), "runs": runs, "balls": balls, "inns": inns,
                          "avg": round(runs / outs, 1) if outs else runs,
                          "sr": round(100 * runs / balls, 1) if balls else 0})
        return {"pid": pid, "years": years}
    return cached("career:" + pid, 3600, build)


def get_player_venues(pid):
    """Per-venue batting line for one player, from cil.db (top venues by runs)."""
    if not _db_ready():
        return None
    def build():
        import sqlite3
        con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
        q = """SELECT m.venue AS venue, m.city AS city,
                 SUM(d.runs_batter) AS runs,
                 SUM(CASE WHEN d.extra_type IS NULL OR d.extra_type<>'wides' THEN 1 ELSE 0 END) AS balls,
                 COUNT(DISTINCT d.match_id || '-' || d.innings_no) AS inns,
                 SUM(CASE WHEN d.player_out_id=d.batter_id THEN 1 ELSE 0 END) AS outs
               FROM fact_delivery d JOIN dim_match m ON d.match_id=m.match_id
               WHERE d.batter_id=? AND m.venue IS NOT NULL AND m.venue<>''
               GROUP BY m.venue HAVING balls>0 ORDER BY runs DESC LIMIT 14"""
        try:
            rows = con.execute(q, (pid,)).fetchall()
        finally:
            con.close()
        out = []
        for r in rows:
            runs, balls, outs, inns = (r["runs"] or 0), (r["balls"] or 0), (r["outs"] or 0), (r["inns"] or 0)
            out.append({"venue": r["venue"], "city": r["city"] or "", "runs": runs,
                        "balls": balls, "inns": inns,
                        "avg": round(runs / outs, 1) if outs else runs,
                        "sr": round(100 * runs / balls, 1) if balls else 0})
        return {"pid": pid, "venues": out}
    return cached("pvenue:" + pid, 3600, build)



def _scan_array(s, j):
    depth, instr, esc, k = 0, False, False, j
    while k < len(s):
        c = s[k]
        if esc:
            esc = False
        elif c == "\\":
            esc = True
        elif c == '"':
            instr = not instr
        elif not instr:
            if c == "[":
                depth += 1
            elif c == "]":
                depth -= 1
                if depth == 0:
                    return s[j:k + 1]
        k += 1
    return None


def _parse_scorecard(html):
    s = _decode_next_stream(html)
    keyn = lambda kv: int(kv[0].split("_")[1]) if "_" in kv[0] else 0
    inns = []
    for raw in _balanced_objects(s, '{"matchId":'):
        try:
            d = json.loads(raw)
        except Exception:
            continue
        if "batTeamDetails" not in d:
            continue
        bt = d.get("batTeamDetails") or {}
        bw = d.get("bowlTeamDetails") or {}
        sd = d.get("scoreDetails") or {}
        ex = d.get("extrasData") or {}
        wk = d.get("wicketsData") or {}
        bats = [{"name": b.get("batName"), "capt": b.get("isCaptain"), "keeper": b.get("isKeeper"),
                 "out": b.get("outDesc") or "", "runs": b.get("runs"), "balls": b.get("balls"),
                 "fours": b.get("fours"), "sixes": b.get("sixes"), "sr": b.get("strikeRate")}
                for k, b in sorted((bt.get("batsmenData") or {}).items(), key=keyn)]
        bowls = [{"name": b.get("bowlName"), "overs": b.get("overs"), "maidens": b.get("maidens"),
                  "runs": b.get("runs"), "wickets": b.get("wickets"), "econ": b.get("economy")}
                 for k, b in sorted((bw.get("bowlersData") or {}).items(), key=keyn)]
        fow = [{"name": w.get("batName"), "over": w.get("wktOver"), "runs": w.get("wktRuns"), "nbr": w.get("wktNbr")}
               for k, w in sorted((wk or {}).items(), key=keyn)]
        inns.append({"battingTeam": bt.get("batTeamName") or "", "bowlingTeam": bw.get("bowlTeamName") or "",
                     "runs": sd.get("runs"), "wickets": sd.get("wickets"), "overs": sd.get("overs"),
                     "runRate": sd.get("runRate"), "extras": ex.get("total"),
                     "batsmen": bats, "bowlers": bowls, "fow": fow})
    return inns


def _parse_squads(html):
    s = _decode_next_stream(html)
    teams = {}
    for mm in re.finditer(r'"playing XI":', s):
        j = s.find("[", mm.end())
        arr = _scan_array(s, j) if j >= 0 else None
        if not arr:
            continue
        try:
            players = json.loads(arr)
        except Exception:
            continue
        for pl in players:
            tn = pl.get("teamName") or "?"
            img = ""
            pid = pl.get("id")
            if pid:
                img = f"https://i.cricketcb.com/stats/img/faceImages/{pid}.jpg"
            teams.setdefault(tn, []).append({"name": pl.get("fullName") or pl.get("name"),
                "role": pl.get("role") or "", "capt": bool(pl.get("captain")),
                "keeper": bool(pl.get("keeper")), "img": img})
    return [{"team": k, "players": v} for k, v in teams.items()]


def _all_objects(s):
    """Yield every balanced {...} object substring in s (all nesting depths),
    respecting JSON string escaping. Lets us find commentary entries regardless
    of their key order or how deeply Cricbuzz nests them."""
    stack = []
    in_str = False
    esc = False
    for i, c in enumerate(s):
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == "{":
                stack.append(i)
            elif c == "}" and stack:
                st = stack.pop()
                yield s[st:i + 1]


def _apply_formats(txt, fmts):
    """Cricbuzz full-commentary embeds tokens (e.g. B0$) replaced by commentaryFormats."""
    if not txt or not isinstance(fmts, dict):
        return txt
    for info in fmts.values():
        if not isinstance(info, dict):
            continue
        ids = info.get("formatId") or []
        vals = info.get("formatValue") or []
        for i, tok in enumerate(ids):
            if tok:
                txt = txt.replace(tok, vals[i] if i < len(vals) else "")
    return txt


def _commentary_entries(s):
    """Parse commentary from a decoded next-stream. Handles both the live page
    (flat {"matchId":...commText...} objects, latest ~20 balls) and the full
    commentary page (nested commentary[].commentaryList[] {"commText":...} entries
    for the whole innings)."""
    ents, seen = [], set()
    for o in _all_objects(s):
        if o.count('"commText"') == 1:   # innermost commentary entry (not the container)
            try:
                d = json.loads(o)
            except Exception:
                continue
            if "commText" not in d:
                continue
            txt = _apply_formats(d.get("commText") or "", d.get("commentaryFormats"))
            t = txt.strip()
            if not t or re.match(r"^\$\w+$", t):
                continue
            ts = d.get("timestamp") or 0
            key = (ts, d.get("ballNbr"), t[:48])
            if key in seen:
                continue
            seen.add(key)
            ev = [e for e in (d.get("event") or []) if str(e).lower() not in ("all", "none")]
            osp = d.get("overSeparator")
            ov = None
            if isinstance(osp, dict):
                bt = osp.get("batTeamObj") or {}
                ov = {"over": osp.get("overNumber"), "runs": osp.get("overRuns"),
                      "score": bt.get("teamScore"), "team": bt.get("teamName")}
            bm = d.get("ballMetric")
            ents.append({"ts": ts, "inn": d.get("inningsId"),
                         "ball": bm if isinstance(bm, (int, float)) else None,
                         "text": txt, "events": ev, "over": ov})
    ents.sort(key=lambda x: x["ts"], reverse=True)
    return ents


def _parse_commentary(html):
    return _commentary_entries(_decode_next_stream(html))


def _parse_facts(html):
    s = _decode_next_stream(html)
    out, seen = [], set()
    for lab, val in re.findall(r'"font-bold","children":"([^"]+)"\}\],\["\$","div",null,\{"children":"([^"]*)"', s):
        if val and lab not in seen:
            seen.add(lab)
            out.append({"label": lab, "value": val})
    return out


# Cricbuzz only server-renders the latest ~2 overs and loads older commentary via
# internal Next.js server actions (no stable GET endpoint). So we ACCUMULATE: each
# poll merges the newest balls into a per-match store on disk, building the whole
# innings over the course of the match. Keyed by (timestamp, ballNbr, text) so
# repeated polls don't duplicate.
_comm_store: dict = {}
_comm_lock = threading.Lock()


def _comm_path(mid):
    return os.path.join(CACHE, f"comm_{mid}.json")


def _comm_load(mid):
    if mid in _comm_store:
        return _comm_store[mid]
    d = {}
    try:
        with open(_comm_path(mid), encoding="utf-8") as f:
            for e in json.load(f):
                d[_comm_key(e)] = e
    except Exception:
        pass
    _comm_store[mid] = d
    return d


def _comm_save(mid, d):
    try:
        with open(_comm_path(mid), "w", encoding="utf-8") as f:
            json.dump(list(d.values()), f)
    except Exception:
        pass


def _comm_key(e):
    return f"{e.get('ts')}|{e.get('inn')}|{(e.get('text') or '')[:48]}"


def get_commentary(mid, slug=None):
    slg = slug or "x"
    # poll the live + full pages at most every 20s, merge whatever they expose now
    def fetch_now():
        ents = []
        for url in (CB_COMMENTARY.format(mid=mid, slug=slg),
                    CB_FULLCOMM.format(mid=mid, slug=slg)):
            try:
                ents += _parse_commentary(_http_get(url))
            except Exception:
                pass
        return ents
    page = cached(f"commpage:{mid}", 20, fetch_now)
    with _comm_lock:
        store = _comm_load(mid)
        changed = False
        for e in page:
            k = _comm_key(e)
            if k not in store:
                store[k] = e
                changed = True
        if changed:
            _comm_save(mid, store)
        ents = sorted(store.values(), key=lambda x: x.get("ts") or 0, reverse=True)
    return {"commentary": ents, "full": len(ents) > 25, "accumulated": len(ents)}


def get_facts(mid, slug=None):
    return cached(f"facts:{mid}:{slug or ''}", 300,
                  lambda: {"facts": _parse_facts(_http_get(CB_FACTS.format(mid=mid, slug=slug or "x")))})


# ---------- player profiles ----------
def _stats_table(block):
    if not isinstance(block, dict):
        return {}
    fmts = (block.get("headers") or [])[1:]
    out = {f: {} for f in fmts}
    for row in block.get("values") or []:
        vals = row.get("values") if isinstance(row, dict) else None
        if not vals:
            continue
        metric = vals[0]
        for i, f in enumerate(fmts, start=1):
            if i < len(vals):
                out[f][metric] = vals[i]
    return out


def _parse_player(html):
    s = _decode_next_stream(html)
    pd = {}
    raw = _object_after(s, '"playerData":')
    if raw:
        try:
            pd = json.loads(raw)
        except Exception:
            pd = {}
    bat = _object_after(s, '"playerBattingStats":')
    bowl = _object_after(s, '"playerBowlingStats":')
    try:
        bat = json.loads(bat) if bat else {}
    except Exception:
        bat = {}
    try:
        bowl = json.loads(bowl) if bowl else {}
    except Exception:
        bowl = {}
    img = pd.get("image") or ""
    if img.startswith("http://"):
        img = "https://" + img[len("http://"):]
    if not img and pd.get("faceImageId"):
        img = f"https://static.cricbuzz.com/a/img/v1/152x152/i1/c{pd['faceImageId']}/x.jpg"
    return {
        "id": pd.get("id"), "name": pd.get("name") or pd.get("fullName") or "",
        "country": pd.get("intlTeam") or "", "role": pd.get("role") or "",
        "battingStyle": pd.get("bat") or "", "bowlingStyle": pd.get("bowl") or "",
        "dob": pd.get("DoBFormat") or pd.get("DoB") or "", "image": img,
        "rankings": pd.get("rankings") or {},
        "batting": _stats_table(bat), "bowling": _stats_table(bowl),
    }


def cricbuzz_profile_candidates(name):
    """Find cricbuzz /profiles/<id>/<slug> links for a name via DuckDuckGo HTML
    (scrapeable, no key; Cricbuzz has no public search page and Google blocks scraping)."""
    q = urllib.parse.quote(f"{name} cricbuzz profile")
    cands = []
    for url in (f"https://html.duckduckgo.com/html/?q={q}",
                f"https://lite.duckduckgo.com/lite/?q={q}"):
        try:
            dec = urllib.parse.unquote(_http_get(url))
        except Exception:
            continue
        for mm in re.finditer(r"cricbuzz\.com/profiles/(\d+)/([a-z0-9-]+)", dec):
            cands.append((mm.group(1), mm.group(2)))
        if cands:
            break
    if not cands:  # last resort
        try:
            from googlesearch import search
            for r in search(f"{name} cricbuzz profile", num_results=5):
                mm = re.search(r"/profiles/(\d+)/([a-z0-9-]+)", r)
                if mm:
                    cands.append((mm.group(1), mm.group(2)))
        except Exception:
            pass
    return cands


def resolve_profile(name):
    """Best-effort name -> (cricbuzz_id, profile_url), cached to disk."""
    pf = os.path.join(CACHE, "profiles.json")
    try:
        db = json.load(open(pf))
    except Exception:
        db = {}
    key = name.lower().strip()
    if key in db:
        v = db[key]
        return (v.get("cid"), v.get("url")) if v else (None, None)
    cands = cricbuzz_profile_candidates(name)
    if not cands:
        db[key] = None
    tokens = [t for t in re.split(r"\s+", name.lower()) if t]
    if cands:
        def score(c):
            slug = c[1].lower()
            return (sum(t in slug for t in tokens), -len(slug))
        cid, slug = sorted(set(cands), key=score, reverse=True)[0]
        url = f"https://www.cricbuzz.com/profiles/{cid}/{slug}"
        db[key] = {"cid": cid, "url": url}
    try:
        json.dump(db, open(pf, "w"))
    except Exception:
        pass
    return (db[key]["cid"], db[key]["url"]) if db.get(key) else (None, None)


def get_player(name=None, url=None, cid=None):
    if not url:
        if cid:
            url = CB_PROFILE.format(cid=cid)
        elif name:
            _, url = resolve_profile(name)
    if not url:
        return None
    return cached("pl:" + url, 3600, lambda: _parse_player(_http_get(url)))


def get_teams(fmt=None, gender=None, intl=False, league=None, xleagues=None):
    """Team table for a cohort, from cil.db dim_match (matches, wins, win%).

    dim_match has no team_type column. International T20 is format='it20'
    (domestic T20 is 't20'); ODI/Test are shared between intl and domestic,
    so for intl ODI/Test we exclude the known domestic-competition leagues
    (passed by the dashboard as xleagues='League A|League B|...').
    Domestic cohorts filter directly by league name.
    """
    if not _db_ready():
        return None
    key = f"teams:{fmt}|{gender}|{intl}|{league}|{hash(xleagues or '')}"
    def build():
        import sqlite3
        con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
        cols = {r[1] for r in con.execute("PRAGMA table_info(dim_match)")}
        has_tt = "team_type" in cols   # correct schema (rebuilt via build_all.py)
        where, args = [], []
        if has_tt:
            # Proper classification: fmt is normalized (t20/odi/test); intl vs club
            # comes straight from Cricsheet's team_type.
            if fmt:
                where.append("format=?"); args.append(fmt)
            if gender:
                where.append("gender=?"); args.append(gender)
            where.append("team_type=?"); args.append("international" if intl else "club")
            if not intl and league:
                where.append("league=?"); args.append(league)
        else:
            # Stale DB (no team_type): T20Is live under format 'it20' (associates only);
            # ODI/Test mix intl+domestic, so exclude known domestic leagues for intl.
            if intl:
                efmt = "it20" if fmt == "t20" else fmt
                if efmt:
                    where.append("format=?"); args.append(efmt)
                if gender:
                    where.append("gender=?"); args.append(gender)
                xs = [x for x in (xleagues or "").split("|") if x.strip()]
                if xs:
                    ph = ",".join("?" * len(xs))
                    where.append(f"(league IS NULL OR league NOT IN ({ph}))")
                    args.extend(xs)
            else:
                if fmt:
                    where.append("format=?"); args.append(fmt)
                if league:
                    where.append("league=?"); args.append(league)
        wsql = (" WHERE " + " AND ".join(where)) if where else ""
        q = f"""WITH m AS (SELECT team_a a, team_b b, winner w FROM dim_match{wsql})
                SELECT team, COUNT(*) mp, SUM(win) wins FROM (
                  SELECT a team, CASE WHEN w=a THEN 1 ELSE 0 END win FROM m WHERE a IS NOT NULL
                  UNION ALL
                  SELECT b team, CASE WHEN w=b THEN 1 ELSE 0 END win FROM m WHERE b IS NOT NULL
                ) GROUP BY team HAVING mp>=3 ORDER BY mp DESC"""
        try:
            rows = con.execute(q, args).fetchall()
        finally:
            con.close()
        teams = []
        for r in rows:
            mp, wins = r["mp"] or 0, r["wins"] or 0
            teams.append({"team": r["team"], "matches": mp, "wins": wins,
                          "winpct": round(100 * wins / mp, 1) if mp else 0})
        return {"teams": teams}
    return cached(key, 1800, build)



# ---------- HTTP ----------
class H(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _redirect(self, url):
        self.send_response(302)
        self.send_header("Location", url)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def log_message(self, *a):
        pass

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        path, qs = u.path, urllib.parse.parse_qs(u.query)
        g = lambda k: (qs.get(k) or [""])[0]
        try:
            if path == "/api/live":
                return self._send(200, get_live())
            if path == "/api/schedule":
                return self._send(200, get_schedule())
            if path == "/api/results":
                return self._send(200, get_results())
            if path == "/api/match":
                mid = g("id")
                d = get_match(mid, g("slug") or None) if mid else None
                return self._send(200 if d else 404, d or {"error": "match not found"})
            if path == "/api/commentary":
                mid = g("id")
                d = get_commentary(mid, g("slug") or None) if mid else None
                return self._send(200 if d else 404, d or {"error": "no commentary"})
            if path == "/api/facts":
                mid = g("id")
                d = get_facts(mid, g("slug") or None) if mid else None
                return self._send(200 if d else 404, d or {"error": "no facts"})
            if path == "/api/career":
                pid = g("pid")
                d = get_career(pid) if pid else None
                return self._send(200 if d else 404, d or {"error": "no career data (is cil.db present?)"})
            if path == "/api/venues_player":
                pid = g("pid")
                d = get_player_venues(pid) if pid else None
                return self._send(200 if d else 404, d or {"error": "no venue data (is cil.db present?)"})
            if path == "/api/teams":
                d = get_teams(fmt=g("fmt") or None, gender=g("gender") or None,
                              intl=g("intl") == "1", league=g("league") or None,
                              xleagues=g("xleagues") or None)
                return self._send(200 if d else 404, d or {"error": "no team data (is cil.db present?)"})
            if path == "/api/player":
                p = get_player(name=g("name"), url=g("url"), cid=g("id"))
                return self._send(200 if p else 404, p or {"error": "player not found"})
            if path == "/api/photo":
                p = None
                if g("url") or g("name") or g("id"):
                    try:
                        p = get_player(name=g("name"), url=g("url"), cid=g("id"))
                    except Exception:
                        p = None
                img = (p or {}).get("image")
                return self._redirect(img) if img else self._send(404, {"error": "no photo"})
            if path == "/api/_debug":
                live = cached("live", 25, lambda: _fetch_matches(CB_LIVE))
                from collections import Counter
                return self._send(200, {
                    "n_parsed": len(live),
                    "states": dict(Counter(_state(d) for d in live)),
                    "sample": _fmt_match(live[0]) if live else None,
                })
        except Exception as e:
            return self._send(500, {"error": repr(e), "hint": "pip install requests"})
        rel = path.lstrip("/") or "index.html"
        fp = os.path.normpath(os.path.join(WEB, rel))
        if not fp.startswith(WEB) or not os.path.isfile(fp):
            return self._send(404, {"error": "not found"})
        ctype = {"html": "text/html", "js": "application/javascript", "css": "text/css",
                 "json": "application/json", "svg": "image/svg+xml"}.get(fp.rsplit(".", 1)[-1],
                                                                          "application/octet-stream")
        is_text = ctype.startswith("text") or "javascript" in ctype
        self._send(200, open(fp, "rb").read(), ctype + ("; charset=utf-8" if is_text else ""))


def main():
    print(f"Cricket Intelligence Lab  ->  http://127.0.0.1:{PORT}")
    print("(Live / Schedule / Results / Match / Player profiles use Cricbuzz - no browser needed.)")
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()  # 0.0.0.0 so cloud hosts can reach it


if __name__ == "__main__":
    main()
