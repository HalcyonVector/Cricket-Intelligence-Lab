#!/usr/bin/env python3
"""Regenerate the Cricsheet-id -> photo bridge appended to web/dashboard/playerimg.js.

Run after the photo crawler updates playerimg.js, or after new matches are ingested:

    python scripts/build_photo_byid.py --zip all_json.zip

It reads the name->URL map (CIL_PLAYERIMG) and the no-photo blocklist (CIL_IMGBLOCK)
already in playerimg.js, then resolves every Cricsheet player id (from the zip
registry) to its photo key ONCE and writes `window.CIL_PLAYERIMG_BYID = {id: key}`.
The dashboard looks photos up by stable player id, so a brand-new player simply gets
no fast-path photo (the server /api/photo fallback still covers them) instead of
inheriting someone else's face.

Collision guard: a surname+initial key (e.g. "gill|s") is only handed to a player when
its photo isn't already claimed by someone's exact full-name match, and when several
players share the key it goes to the most-capped one. This stops e.g. a journeyman
"S Gill" borrowing Shubman Gill's photo.
"""
import argparse, collections, json, os, re, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIMG = os.path.join(ROOT, "web", "dashboard", "playerimg.js")

# Curated aliases: Cricsheet name -> Cricbuzz photo key, for players whose names
# name-matching can't bridge (different surname, or initials vs full first name).
ALIAS = {
    "LD Chandimal": "dineshchandimal",
    "FH Allen": "finnallen",
    "PWH de Silva": "waninduhasaranga",
    "RG Sharma": "rohitsharma",
}


def _keys(n):
    t = [x for x in re.sub(r"[^a-z ]", "", (n or "").lower()).split() if x]
    return ["".join(t), t[-1] + "|" + t[0][0]] if t else ["", ""]


def _slug(u):
    m = re.search(r"/c\d+/([a-z0-9-]+)\.jpg", u or "")
    return m.group(1) if m else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", default=os.path.join(ROOT, "all_json.zip"))
    ap.add_argument("--playerimg", default=PIMG)
    a = ap.parse_args()

    raw = open(a.playerimg, encoding="utf-8").read()
    M = json.loads(re.search(r"window\.CIL_PLAYERIMG=(\{.*?\});", raw, re.S).group(1))
    bm = re.search(r"window\.CIL_IMGBLOCK=(\{.*?\});", raw, re.S)
    B = json.loads(bm.group(1)) if bm else {}

    # id -> name and per-id match appearances, pulled fast from each match's registry block
    people_re = re.compile(rb'"people"\s*:\s*\{(.*?)\}', re.S)
    pair_re = re.compile(rb'"((?:[^"\\]|\\.)+)"\s*:\s*"([0-9a-f]+)"')
    z = zipfile.ZipFile(a.zip)
    id2name, apps = {}, collections.Counter()
    for info in z.infolist():
        if not info.filename.endswith(".json") or info.filename.endswith("_info.json"):
            continue
        m = people_re.search(z.read(info.filename))
        if not m:
            continue
        for nm, pid in pair_re.findall(m.group(1)):
            nm, pid = nm.decode("utf-8", "replace"), pid.decode()
            id2name.setdefault(pid, nm)
            apps[pid] += 1

    # Pass 1: curated aliases + exact full-name matches (unambiguous). Record photos they own.
    byid, owned_slugs, si_claims = {}, set(), collections.defaultdict(list)
    for pid, nm in id2name.items():
        fk, sk = _keys(nm)
        if nm in ALIAS and ALIAS[nm] in M:
            byid[pid] = ALIAS[nm]; owned_slugs.add(_slug(M[ALIAS[nm]])); continue
        if fk in M:
            byid[pid] = fk; owned_slugs.add(_slug(M[fk])); continue
        if sk in M and not B.get(fk):
            si_claims[sk].append(pid)

    # Pass 2: surname+initial keys. Skip any whose photo is already a full-name match
    # (a different person sharing surname+initial); else assign to the most-capped claimant.
    for sk, ids in si_claims.items():
        if _slug(M[sk]) in owned_slugs:
            continue
        byid[max(ids, key=lambda p: apps[p])] = sk

    base = re.sub(r"\nwindow\.CIL_PLAYERIMG_BYID=.*?;\s*$", "", raw.rstrip(), flags=re.S).rstrip()
    base += "\nwindow.CIL_PLAYERIMG_BYID=" + json.dumps(byid, separators=(",", ":")) + ";\n"
    tmp = a.playerimg + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(base)
        f.flush(); os.fsync(f.fileno())
    os.replace(tmp, a.playerimg)
    print(f"CIL_PLAYERIMG_BYID: {len(byid)} ids resolved (of {len(id2name)} seen). Wrote {a.playerimg}.")


if __name__ == "__main__":
    main()
