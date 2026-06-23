#!/usr/bin/env python3
"""Fetch current ICC rankings (men's & women's; Test/ODI/T20I; batting / bowling /
all-rounder + team rankings) into  web/dashboard/rankings.js , which the dashboard
loads to show an "ICC Rankings" tab.

icc-cricket.com is a JavaScript app and renders rankings through a custom widget of
<div class="si-table-row"> elements (NOT an HTML <table>), so a plain
requests/BeautifulSoup scrape returns nothing. This script renders the page with a
headless browser (Playwright) and reads the widget's cells:
    .si-pos  .si-player  .si-team  .si-rating
Tied ranks render the position cell as a bare "=" (same rank as the row above), so we
carry the previous rank forward. A generic <table>/[role=row] token parser is kept as
a fallback in case ICC changes the markup again.

ONE-TIME SETUP:
    pip install playwright
    python -m playwright install chromium

RUN (from the project root):
    python scripts/fetch_icc_rankings.py            # live (headless browser)
    python scripts/fetch_icc_rankings.py --demo     # tiny sample, to preview the tab
    python scripts/fetch_icc_rankings.py --debug     # also dump rendered HTML for diagnosis

If a table comes back empty the script saves the rendered HTML to scripts/_debug_*.html
and keeps going - send me one of those files and I'll adjust the parser.
"""
from __future__ import annotations
import argparse, json, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "dashboard", "rankings.js")
DBG = os.path.dirname(os.path.abspath(__file__))

# Correct current URL structure (verified June 2026):
#   players: /rankings/{batting|bowling|allrounder}/{mens|womens}/{test|odi|t20i}
#   teams:   /rankings/team-rankings/{mens|womens}/{test|odi|t20i}
# Note: women's Test rankings do not exist (women play only ODI/T20I internationally).
PLAYER_SPECS, TEAM_SPECS = [], []
for gender in ("mens", "womens"):
    formats = ("test", "odi", "t20i") if gender == "mens" else ("odi", "t20i")
    for fmt in formats:
        for disc in ("batting", "bowling", "allrounder"):
            PLAYER_SPECS.append((gender, fmt, disc))
        TEAM_SPECS.append((gender, fmt))


def _title(gender, fmt, disc=None):
    g = "Men's" if gender == "mens" else "Women's"
    fm = {"test": "Test", "odi": "ODI", "t20i": "T20I"}[fmt]
    return f"{g} {fm} - {disc.replace('allrounder', 'All-Rounder').title()}" if disc else f"{g} {fm} - Teams"


# PRIMARY extractor: read ICC's "si-" ranking widget. Returns one object per row with
# the raw cell strings; Python cleans them (carry-forward ties, dedup, etc.).
_SI_JS = """() => {
  const body = document.querySelector('.si-table-body') || document.body;
  const out = [];
  body.querySelectorAll('.si-table-row').forEach(r => {
    const txt = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
    const pos = txt(r.querySelector('.si-pos .si-text') || r.querySelector('.si-pos'));
    const fn = r.querySelector('.si-player .si-fname');
    const ln = r.querySelector('.si-player .si-lname');
    let player = '';
    if (fn || ln) player = (txt(fn) + ' ' + txt(ln)).replace(/\\s+/g, ' ').trim();
    else player = txt(r.querySelector('.si-player .si-player-name') || r.querySelector('.si-table-data.si-player'));
    const tf = r.querySelector('.si-team .si-fname');
    const ts = r.querySelector('.si-team .si-sname');
    let team = txt(tf) || txt(ts);
    if (!team) team = txt(r.querySelector('.si-table-data.si-team'));
    const rating = txt(r.querySelector('.si-rating .si-text') || r.querySelector('.si-table-data.si-rating'));
    out.push({pos, player, team, rating});
  });
  return out;
}"""


def rows_from_si(si_rows, kind):
    """Clean the widget rows: parse rank, carry forward ties, dedup."""
    rows, seen, last = [], set(), 0
    for d in si_rows:
        pos = (d.get("pos") or "").strip()
        m = re.match(r"^=?(\d{1,3})$", pos)
        if m:
            last = int(m.group(1))
        elif pos in ("=", ""):
            pass  # tie -> reuse previous rank
        else:
            continue  # header ("pos") or junk
        if not last:
            continue
        rank = last
        player = (d.get("player") or "").strip()
        team = (d.get("team") or "").strip()
        rating = (d.get("rating") or "").replace(",", "").strip()
        name = team if kind == "team" else player
        if not name and kind == "team":
            name = player
        if not name:
            continue
        key = (rank, name.lower())
        if key in seen:
            continue
        seen.add(key)
        rows.append({"rank": rank, "team": name, "rating": rating} if kind == "team"
                    else {"rank": rank, "player": player, "team": team, "rating": rating})
    return rows


# FALLBACK extractor (old behaviour): every "row" candidate as a list of text tokens.
_ROW_JS = """() => {
  const out = [];
  const rows = document.querySelectorAll('table tr, [role=\"row\"]');
  rows.forEach(r => {
    let cells = Array.from(r.querySelectorAll('td, th, [role=\"cell\"]'))
                     .map(c => (c.innerText || '').trim()).filter(Boolean);
    if (cells.length >= 2 && cells.length <= 9) out.push(cells);
  });
  return out;
}"""


def rows_from_tokens(token_rows, kind):
    """Turn raw token lists into clean ranking rows, keeping the longest sequential run."""
    seen, rows = set(), []
    for t in token_rows:
        if not re.match(r"^=?\d{1,3}$", t[0]):
            continue
        rank = int(t[0].lstrip("="))
        if rank < 1 or rank > 100:
            continue
        rest = t[1:]
        nums = [x for x in rest if re.match(r"^\d[\d,]*$", x)]
        texts = [x for x in rest if not re.match(r"^[=\d][\d,]*$", x) and len(x) > 1]
        if not texts or not nums:
            continue
        rating = nums[-1].replace(",", "")
        name = texts[0]
        team = texts[1] if len(texts) > 1 else ""
        key = (rank, name.lower())
        if key in seen:
            continue
        seen.add(key)
        rows.append({"rank": rank, "team": name, "rating": rating} if kind == "team"
                    else {"rank": rank, "player": name, "team": team, "rating": rating})
    rows.sort(key=lambda r: r["rank"])
    clean, expect = [], 1
    for r in rows:
        if r["rank"] == expect:
            clean.append(r); expect += 1
        elif r["rank"] > expect:
            break
    return clean or rows


def live(debug=False):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("Playwright not installed. Run:\n"
                 "    pip install playwright\n"
                 "    python -m playwright install chromium")
    tables, failed = [], []
    base = "https://www.icc-cricket.com/rankings"
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(user_agent="Mozilla/5.0")

        def grab(url, kind, title):
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=60000)
                try:
                    page.wait_for_selector('.si-table-row, table tr, [role="row"]', timeout=20000)
                except Exception:
                    pass
                page.wait_for_timeout(1200)
                si_rows = page.evaluate(_SI_JS)
                rows = rows_from_si(si_rows, kind)
                if not rows:  # widget markup changed? fall back to generic table parser
                    rows = rows_from_tokens(page.evaluate(_ROW_JS), kind)
                html = page.content()
            except Exception as e:
                print(f"  ! {title}: {e}"); failed.append(url); return
            if rows:
                tables.append({"title": title, "kind": kind, "rows": rows[:25]})
                print(f"  ok {title} ({len(rows)} rows)")
            else:
                failed.append(url)
                if debug:
                    p = os.path.join(DBG, "_debug_" + re.sub(r"\W+", "_", title) + ".html")
                    open(p, "w", encoding="utf-8").write(html)
                    print(f"  -- {title}: 0 rows (saved {os.path.basename(p)})")
                else:
                    print(f"  -- {title}: 0 rows")

        for gender, fmt, disc in PLAYER_SPECS:
            grab(f"{base}/{disc}/{gender}/{fmt}", "player", _title(gender, fmt, disc)); time.sleep(0.3)
        for gender, fmt in TEAM_SPECS:
            grab(f"{base}/team-rankings/{gender}/{fmt}", "team", _title(gender, fmt)); time.sleep(0.3)
        browser.close()
    if failed:
        print(f"\n{len(failed)} page(s) returned no rows. Re-run with --debug and send me a _debug_*.html.")
    return tables


def demo():
    return [
        {"title": "Men's ODI - Batting", "kind": "player",
         "rows": [{"rank": 1, "player": "(sample) Top Batter", "team": "IND", "rating": "800"}]},
        {"title": "Men's Test - Teams", "kind": "team",
         "rows": [{"rank": 1, "team": "(sample) Top Team", "rating": "120"}]},
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--debug", action="store_true")
    a = ap.parse_args()
    tables = demo() if a.demo else live(debug=a.debug)
    if not tables:
        sys.exit("No tables parsed. Try --demo to preview the tab, or re-run with --debug.")
    payload = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "source": "icc-cricket.com", "tables": tables}
    open(OUT, "w", encoding="utf-8").write("window.CIL_RANKINGS=" + json.dumps(payload, separators=(",", ":")) + ";")
    print(f"\nWrote {OUT} ({len(tables)} tables). Reload the dashboard - an 'ICC Rankings' tab appears.")


if __name__ == "__main__":
    main()
