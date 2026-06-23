#!/usr/bin/env python3
"""One-time PROBE: prints the exact shape of ESPNcricinfo data so the live/schedule/
photo fetcher can be written to parse it correctly. It changes nothing — just prints.

SETUP (once):
    pip install python-espncricinfo
    python -m playwright install webkit        # the library renders via a headless browser

RUN:
    python scripts/probe_cricinfo.py  > probe_output.txt   2>&1

Then send me probe_output.txt (or paste it).
"""
import json, re, sys

def show(label, obj, limit=2500):
    print("\n" + "=" * 70 + f"\n{label}\n" + "=" * 70)
    try:
        print(json.dumps(obj, indent=2, default=str)[:limit])
    except Exception as e:
        print("(could not json-dump)", e); print(repr(obj)[:limit])

def find_images(obj):
    txt = json.dumps(obj, default=str)
    hits = set(re.findall(r'"([^"]*[Ii]mage[^"]*|[^"]*headshot[^"]*|[^"]*photo[^"]*)"\s*:\s*"([^"]+)"', txt))
    for k, v in list(hits)[:20]:
        print(f"  image-ish: {k} = {v}")

print("python-espncricinfo probe")
try:
    import espncricinfo, pkgutil
    print("package version:", getattr(espncricinfo, "__version__", "?"))
    print("modules:", [m.name for m in pkgutil.iter_modules(espncricinfo.__path__)])
except Exception as e:
    sys.exit(f"Install first:  pip install python-espncricinfo  &&  python -m playwright install webkit\n({e})")

# ---- 1. Summary: live / recent matches ----
try:
    from espncricinfo.summary import Summary
    s = Summary()
    ms = s.matches
    print(f"\nSummary().matches -> {len(ms)} matches")
    if ms:
        show("SAMPLE MATCH [0] (full)", ms[0])
        print("\nkeys in a match:", list(ms[0].keys()) if isinstance(ms[0], dict) else type(ms[0]))
        # print state/status of all so we can split live vs upcoming
        print("\nstate/status of each match:")
        for m in ms[:30]:
            if isinstance(m, dict):
                print("  ", {k: m.get(k) for k in ("state", "status", "statusText", "stage", "startTime", "startDate") if k in m})
except Exception as e:
    print("Summary error:", repr(e))

# ---- 2. Player: image + bio (Kohli = 253802) ----
try:
    from espncricinfo.player import Player
    p = Player(253802)
    print("\nPlayer(253802) public attrs:", [a for a in dir(p) if not a.startswith("_")])
    for k in ("name", "image", "image_url", "headshot", "headshot_image_url", "imageUrl", "country", "playing_role"):
        try:
            print(f"  p.{k} = {getattr(p, k)}")
        except Exception:
            pass
    j = getattr(p, "json", None) or getattr(p, "_json", None)
    if j is not None:
        print("\nplayer json top-level keys:", list(j.keys()) if isinstance(j, dict) else type(j))
        find_images(j)
        show("PLAYER JSON (truncated)", j, 1800)
except Exception as e:
    print("Player error:", repr(e))

print("\n\nDONE. Send me everything above.")
