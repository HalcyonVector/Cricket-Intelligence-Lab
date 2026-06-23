#!/usr/bin/env python3
"""Post-rebuild integrity check for Cricket Intelligence Lab.
Run AFTER:  python build_all.py --zip all_json.zip
Usage:      python verify_build.py
Exits 0 if all green, 1 if anything is still broken."""
import os, re, json, glob, sqlite3, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DASH = os.path.join(ROOT, "web", "dashboard")
COH  = os.path.join(DASH, "cohorts")
ok = True
def check(label, good, detail=""):
    global ok
    print(f"  [{'OK ' if good else 'FAIL'}] {label}{(' - '+detail) if detail else ''}")
    ok = ok and good

print("== cohort bundles ==")
files = [f for f in sorted(glob.glob(os.path.join(COH, "*.js"))) if os.path.basename(f) != "index.js"]
bad = []
for f in files:
    data = open(f, "rb").read()
    if b"\x00" in data: bad.append((os.path.basename(f), "null bytes")); continue
    txt = data.decode("utf-8", "replace").strip()
    if not (txt.endswith(");") or txt.endswith(")")): bad.append((os.path.basename(f), "bad tail")); continue
    try:
        inner = txt[txt.index("(")+1: txt.rindex(")")].rstrip(";")
        json.loads("[" + inner + "]")
    except Exception as e:
        bad.append((os.path.basename(f), f"parse: {str(e)[:40]}"))
check(f"{len(files)} cohort files parse cleanly", not bad, "" if not bad else f"{len(bad)} broken")
for n, why in bad: print(f"         - {n}: {why}")

print("== playerimg.js ==")
try:
    raw = open(os.path.join(DASH, "playerimg.js"), encoding="utf-8").read()
    m = json.loads(re.search(r"window\.CIL_PLAYERIMG=(\{.*?\});", raw, re.S).group(1))
    check(f"playerimg.js valid", True, f"{len(m)} keys")
except Exception as e:
    check("playerimg.js valid", False, str(e)[:50])

print("== index.html ==")
try:
    h = open(os.path.join(DASH, "index.html"), encoding="utf-8").read()
    check("index.html ends with </html>", h.rstrip().endswith("</html>"))
    check("script tags balanced", h.count("<script") == h.count("</script>"),
          f"{h.count('<script')}/{h.count('</script>')}")
except Exception as e:
    check("index.html readable", False, str(e)[:50])

print("== cil.db ==")
try:
    con = sqlite3.connect(f"file:{os.path.join(ROOT,'cil.db')}?mode=ro", uri=True)
    qc = con.execute("PRAGMA quick_check").fetchone()[0]
    check("cil.db quick_check", qc == "ok", qc)
    for t in ("fact_delivery", "dim_match"):
        try:
            n = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            check(f"{t} rows", n > 0, f"{n:,}")
        except Exception as e:
            check(f"{t}", False, str(e)[:40])
    con.close()
except Exception as e:
    check("cil.db opens", False, str(e)[:50])

print("\n" + ("ALL GREEN" if ok else ">>> ISSUES REMAIN <<<"))
sys.exit(0 if ok else 1)
