#!/usr/bin/env python3
"""Diagnose how to reach ESPNcricinfo's consumer JSON API from this machine.

The first attempt (navigate Chromium to the JSON URL, read document.body.innerText)
returned empty / non-JSON - a top-level navigation to a JSON endpoint gets either
Chrome's JSON viewer or an Akamai block. So this probe tries SEVERAL methods and
prints the HTTP status + a snippet of the raw body for each, so we can see which one
actually returns JSON:

  A. plain `requests` GET with browser-like headers
  B. Playwright APIRequestContext GET (HTTP client sharing Playwright's stack)
  C. Playwright page.goto -> read the *navigation response* .text() (not innerText)
  D. Playwright: load espncricinfo.com first (for Akamai cookies), then fetch() the
     API from inside the page (correct Origin/Referer/cookies; CORS-allowed)

ONE-TIME SETUP:
    pip install playwright requests
    python -m playwright install chromium

RUN (from project root):
    python scripts/probe_espn_api.py > probe_output.txt 2>&1
    python scripts/probe_espn_api.py --player 253802     # probe a specific player id

Paste probe_output.txt back and serve.py's fetch method + field mapping get finalised.
"""
from __future__ import annotations
import argparse, json, sys

LIVE_URL = "https://hs-consumer-api.espncricinfo.com/v1/pages/matches/live?lang=en&latest=true"
PLAYER_URL = "https://hs-consumer-api.espncricinfo.com/v1/pages/player/home?playerId={pid}&lang=en"
SCHEDULE_CANDIDATES = [
    "https://hs-consumer-api.espncricinfo.com/v1/pages/matches/current?lang=en",
    "https://hs-consumer-api.espncricinfo.com/v1/pages/matches/scheduled?lang=en",
    "https://hs-consumer-api.espncricinfo.com/v1/pages/fixtures/home?lang=en",
]
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.espncricinfo.com/",
    "Origin": "https://www.espncricinfo.com",
}


def snippet(s, n=400):
    s = (s or "").strip().replace("\n", " ")
    return s[:n] + ("..." if len(s) > n else "")


def report(method, url, status, body):
    ok_json = False
    parsed = None
    try:
        parsed = json.loads(body)
        ok_json = True
    except Exception:
        pass
    print(f"\n[{method}] status={status}  json={'YES' if ok_json else 'no'}  len={len(body or '')}")
    print(f"    url: {url}")
    if ok_json and isinstance(parsed, dict):
        print(f"    top-level keys: {list(parsed.keys())[:15]}")
    print(f"    body: {snippet(body)}")
    return ok_json, parsed


def method_requests(url):
    import requests
    r = requests.get(url, headers=HEADERS, timeout=30)
    return r.status_code, r.text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--player", default="253802")
    a = ap.parse_args()
    player_url = PLAYER_URL.format(pid=a.player)
    targets = [("LIVE", LIVE_URL), ("PLAYER", player_url)] + \
              [(f"SCHED{i+1}", u) for i, u in enumerate(SCHEDULE_CANDIDATES)]

    # ---- A: requests ----
    print("=" * 72 + "\nMETHOD A: plain requests\n" + "=" * 72)
    for name, url in targets:
        try:
            st, body = method_requests(url)
            report(f"A/{name}", url, st, body)
        except Exception as e:
            print(f"\n[A/{name}] EXCEPTION: {e!r}\n    url: {url}")

    # ---- Playwright methods ----
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("\nPlaywright not installed - skipping methods B/C/D. "
              "Run: pip install playwright && python -m playwright install chromium")
        return

    with sync_playwright() as pw:
        # B: APIRequestContext
        print("\n" + "=" * 72 + "\nMETHOD B: Playwright APIRequestContext\n" + "=" * 72)
        try:
            rc = pw.request.new_context(extra_http_headers=HEADERS)
            for name, url in targets:
                try:
                    resp = rc.get(url, timeout=30000)
                    report(f"B/{name}", url, resp.status, resp.text())
                except Exception as e:
                    print(f"\n[B/{name}] EXCEPTION: {e!r}\n    url: {url}")
            rc.dispose()
        except Exception as e:
            print(f"  method B unavailable: {e!r}")

        browser = pw.chromium.launch()
        page = browser.new_page(user_agent=HEADERS["User-Agent"])

        # C: navigation response .text()
        print("\n" + "=" * 72 + "\nMETHOD C: page.goto -> response.text()\n" + "=" * 72)
        for name, url in targets:
            try:
                resp = page.goto(url, wait_until="domcontentloaded", timeout=45000)
                st = resp.status if resp else "none"
                body = resp.text() if resp else ""
                report(f"C/{name}", url, st, body)
            except Exception as e:
                print(f"\n[C/{name}] EXCEPTION: {e!r}\n    url: {url}")

        # D: load site first, then in-page fetch
        print("\n" + "=" * 72 + "\nMETHOD D: load espncricinfo.com, then in-page fetch()\n" + "=" * 72)
        try:
            page.goto("https://www.espncricinfo.com/", wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(1500)
            for name, url in targets:
                try:
                    res = page.evaluate(
                        """async (u) => {
                            try {
                                const r = await fetch(u, {headers: {'Accept':'application/json'}, credentials:'include'});
                                const t = await r.text();
                                return {status: r.status, body: t};
                            } catch (e) { return {status: 'fetch-error', body: String(e)}; }
                        }""", url)
                    report(f"D/{name}", url, res.get("status"), res.get("body"))
                except Exception as e:
                    print(f"\n[D/{name}] EXCEPTION: {e!r}\n    url: {url}")
        except Exception as e:
            print(f"  method D could not load espncricinfo.com: {e!r}")

        browser.close()

    print("\n\nDone. Paste this whole output back. The method showing status=200 + json=YES "
          "is the one serve.py will use; the SCHED* line with json=YES + match data picks "
          "the schedule endpoint.")


if __name__ == "__main__":
    main()
