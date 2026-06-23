#!/usr/bin/env python3
"""Find where Cricbuzz exposes the FULL innings commentary. The SSR pages only
inline ~2 overs, so this tries candidate URLs and, for any 200 HTML response,
decodes the Next.js stream and counts how many commentary entries it actually
contains (+ over range). Whichever URL yields the most overs is what serve.py
will use.

RUN:  python scripts/probe_cb_api.py --id 121928 --slug scow-vs-nzw-19th-match-group-b-icc-womens-t20-world-cup-2026
"""
from __future__ import annotations
import argparse, json, sys

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/json,*/*",
    "Referer": "https://www.cricbuzz.com/",
    "Accept-Language": "en-US,en;q=0.9",
}


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


def coverage(html):
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
    return len(ents), ((min(overs), max(overs)) if overs else None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True)
    ap.add_argument("--slug", default="x")
    a = ap.parse_args()
    try:
        import requests
    except ImportError:
        sys.exit("pip install requests")
    mid, slug = a.id, a.slug
    urls = [
        f"https://www.cricbuzz.com/api/cricket-match/commentary/{mid}",
        f"https://www.cricbuzz.com/api/cricket-match/commentary/{mid}/{slug}",
        f"https://www.cricbuzz.com/cricket-commentary/{mid}/{slug}",
        f"https://www.cricbuzz.com/live-cricket-full-commentary/{mid}/{slug}/1",
        f"https://www.cricbuzz.com/live-cricket-full-commentary/{mid}/{slug}/2",
        f"https://www.cricbuzz.com/cricket-full-commentary/{mid}/{slug}",
    ]
    for url in urls:
        try:
            r = requests.get(url, headers=HEADERS, timeout=25)
        except Exception as e:
            print(f"\n[{url}]\n   EXCEPTION {e!r}")
            continue
        n, ov = (coverage(r.text) if r.status_code == 200 else (0, None))
        print(f"\n[{url}]\n   status={r.status_code}  len={len(r.text)}  commentary_entries={n}  over_range={ov}")
    print("\nDone. Paste this whole output. The URL with the largest over_range is the one I'll use.")


if __name__ == "__main__":
    main()
