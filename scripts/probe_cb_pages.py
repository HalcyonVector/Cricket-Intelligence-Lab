#!/usr/bin/env python3
"""Confirm Cricbuzz /cricket-commentary pagination. It returns ~2 overs per page;
this walks page suffixes /1../N and ?page=N and prints the over range each yields.
If consecutive pages give consecutive over ranges, serve.py loops them to build the
whole innings.

RUN: python scripts/probe_cb_pages.py --id 121928 --slug scow-vs-nzw-19th-match-group-b-icc-womens-t20-world-cup-2026
"""
from __future__ import annotations
import argparse, json, sys

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
           "Accept-Language": "en-US,en;q=0.9"}


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
                yield s[stack.pop():i + 1]


def cov(html):
    s = decode_next_stream(html)
    overs, inns = [], set()
    for o in all_objects(s):
        if o.count('"commText"') == 1:
            try:
                d = json.loads(o)
            except Exception:
                continue
            if "commText" not in d:
                continue
            inns.add(d.get("inningsId"))
            osp = d.get("overSeparator")
            if isinstance(osp, dict) and osp.get("overNumber") is not None:
                overs.append(osp["overNumber"])
    return ((min(overs), max(overs)) if overs else None), sorted(i for i in inns if i is not None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True)
    ap.add_argument("--slug", required=True)
    a = ap.parse_args()
    import requests
    base = f"https://www.cricbuzz.com/cricket-commentary/{a.id}/{a.slug}"
    tests = [base] + [f"{base}/{n}" for n in (2, 3, 4, 6, 9)] + [f"{base}?page={n}" for n in (2, 4)]
    for url in tests:
        try:
            r = requests.get(url, headers=HEADERS, timeout=25)
            ov, inns = cov(r.text) if r.status_code == 200 else (None, [])
            print(f"{url}\n   status={r.status_code} len={len(r.text)} over_range={ov} innings={inns}")
        except Exception as e:
            print(f"{url}\n   EXCEPTION {e!r}")
    print("\nDone. Paste it all. If /2 /3 /4 give different consecutive over ranges, "
          "that's the pagination I'll loop to assemble the full innings.")


if __name__ == "__main__":
    main()
