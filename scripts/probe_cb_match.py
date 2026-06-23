#!/usr/bin/env python3
"""Capture Cricbuzz match pages AND report how much commentary each page inlines,
so we can tell whether the full-commentary page server-renders the whole innings
or only the latest few overs (and thus whether we need pagination).

SETUP:  pip install requests
RUN  :  python scripts/probe_cb_match.py                 # auto-pick a LIVE match
        python scripts/probe_cb_match.py --id 150679 --slug some-match-slug
"""
from __future__ import annotations
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
           "Accept-Language": "en-US,en;q=0.9"}
ROUTES = {
    "facts":      "https://www.cricbuzz.com/cricket-match-facts/{id}/{slug}",
    "commentary": "https://www.cricbuzz.com/live-cricket-scores/{id}/{slug}",
    "fullcomm":   "https://www.cricbuzz.com/live-cricket-full-commentary/{id}/{slug}",
    "score":      "https://www.cricbuzz.com/live-cricket-scorecard/{id}/{slug}",
    "squads":     "https://www.cricbuzz.com/cricket-match-squads/{id}/{slug}",
}


def get(url):
    import requests
    r = requests.get(url, headers=HEADERS, timeout=30, allow_redirects=True)
    return r.status_code, r.text


def decode_next_stream(html):
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


def all_objects(s):
    stack, in_str, esc = [], False, False
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


def coverage(name, html):
    s = decode_next_stream(html)
    ents = []
    for o in all_objects(s):
        if o.count('"commText"') == 1:
            try:
                d = json.loads(o)
            except Exception:
                continue
            if "commText" in d:
                ents.append(d)
    overs = [e.get("overSeparator", {}).get("overNumber") for e in ents
             if isinstance(e.get("overSeparator"), dict)]
    overs = [o for o in overs if o is not None]
    inns = sorted({e.get("inningsId") for e in ents if e.get("inningsId") is not None})
    ts = [e.get("timestamp") for e in ents if e.get("timestamp")]
    print(f"   commentary entries parsed : {len(ents)}")
    print(f"   distinct innings          : {inns}")
    print(f"   over-separator range      : {(min(overs), max(overs)) if overs else 'none'}")
    if ts:
        print(f"   timestamp span (oldest..newest): {min(ts)} .. {max(ts)}")
    pg = [tok for tok in ('"hasMore"', '"loadMore"', '"pagination"', '"oldestTs"',
                          '"lastTimestamp"', '"pageStartTs"', '"nextPageTs"', '"morePages"')
          if tok in s]
    print(f"   pagination-ish fields     : {pg or 'none found'}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", default=None)
    ap.add_argument("--slug", default="x")
    a = ap.parse_args()
    try:
        import requests  # noqa
    except ImportError:
        sys.exit("pip install requests")
    mid, slug = a.id, a.slug
    if not mid:
        try:
            _, h = get("https://www.cricbuzz.com/cricket-match/live-scores")
            mm = re.search(r"/live-cricket-scores/(\d+)/([a-z0-9-]+)", h)
            if mm:
                mid, slug = mm.group(1), mm.group(2)
                print(f"auto-picked LIVE match {mid} ({slug})")
        except Exception:
            pass
        if not mid:
            sys.exit("Pass --id and --slug (find them in a Cricbuzz match URL).")
    for name, tpl in ROUTES.items():
        url = tpl.format(id=mid, slug=slug)
        try:
            st, html = get(url)
            open(os.path.join(HERE, f"_cb_{name}.html"), "w", encoding="utf-8").write(html)
            print(f"\n### {name}: HTTP {st}  ({url})")
            if st == 200 and name in ("commentary", "fullcomm"):
                coverage(name, html)
        except Exception as e:
            print(f"### {name}: FAILED {e!r}")
    print("\nDone. Paste the COMMENTARY COVERAGE numbers. If 'fullcomm' shows far more "
          "entries than 'commentary', the parser fix already gives full commentary. "
          "If both are ~20 and pagination fields appear, I'll wire timestamp pagination.")


if __name__ == "__main__":
    main()
