"""Browser smoke test: open every main view in headless Chromium and fail on JS errors.

Runs serve.py against the data in web/dashboard/ (python scripts/fetch_data.py first), so
it checks the real dashboard with real bundles. Not collected by pytest (needs a browser):

    pip install playwright requests && python -m playwright install chromium
    python tests/browser/smoke.py
"""
import os, socket, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PORT = int(os.environ.get("SMOKE_PORT", "5077"))
BASE = f"http://127.0.0.1:{PORT}"

# (name, path, CSS/text selector that must appear)
PAGES = [
    ("landing", "/", "text=Open the dashboard"),
    ("overview", "/dashboard/index.html#c=t20i_men", ".homex .hx-tile"),
    ("batters", "/dashboard/index.html#c=t20i_men&v=players", "#pt tbody tr"),
    ("batters, time window", "/dashboard/index.html#c=t20i_men&v=players&since=2023", ".sinceban"),
    ("bowlers, full members", "/dashboard/index.html#c=t20i_men&v=bowlers&fm=1", "#bt tbody tr"),
    ("batter profile", "/dashboard/index.html#c=t20i_men&p=ba607b88", "text=Phase profile"),
    ("bowler profile", "/dashboard/index.html#c=t20i_men&v=bowlers&b=249d60c9", "text=Form by year"),
    ("compare", "/dashboard/index.html#c=t20i_men&v=compare", "text=Side by side"),
    ("matchups", "/dashboard/index.html#c=t20i_men&v=matchups", "#mb"),
    ("bowl to", "/dashboard/index.html#c=t20i_men&v=bowlto", "#btq"),
    ("matches", "/dashboard/index.html#c=t20i_men&v=matches", ".mrow"),
    ("teams", "/dashboard/index.html#c=t20i_men&v=teams", ".rowlinks tbody tr"),
    ("team page", "/dashboard/index.html#c=t20i_men&v=teams&tm=India", "text=Head to head"),
    ("venues", "/dashboard/index.html#c=t20i_men&v=venues", ".rowlinks tbody tr"),
    ("records", "/dashboard/index.html#c=t20i_men&v=records", ".recchips"),
    ("research", "/dashboard/index.html#c=t20i_men&v=research", "#rsc svg"),
    ("network", "/dashboard/index.html#c=t20i_men&v=network", ".netn"),
    ("league", "/dashboard/index.html#c=indian_premier_league", ".homex .hx-tile"),
    ("test cohort", "/dashboard/index.html#c=test_men&v=players", "#pt tbody tr"),
]


def wait_port(port, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.3)
    raise SystemExit(f"server did not start on :{port}")


def main():
    env = dict(os.environ, PORT=str(PORT))
    srv = subprocess.Popen([sys.executable, "serve.py"], cwd=ROOT, env=env)
    failures = []
    try:
        wait_port(PORT)
        with sync_playwright() as p:
            b = p.chromium.launch()
            for name, path, sel in PAGES:
                pg = b.new_page(viewport={"width": 1280, "height": 900})
                errs = []
                pg.on("pageerror", lambda e, errs=errs: errs.append(str(e)))
                try:
                    pg.goto(BASE + path)
                    pg.wait_for_selector(sel, timeout=30000)
                    pg.wait_for_timeout(500)  # let lazy files and late panels settle
                except Exception as e:
                    errs.append(f"expected {sel!r}: {str(e).splitlines()[0]}")
                print(("FAIL " if errs else "ok   ") + name + ("" if not errs else f"  -> {errs}"))
                if errs:
                    failures.append(name)
                pg.close()
            b.close()
    finally:
        srv.terminate()
    if failures:
        raise SystemExit(f"{len(failures)} page(s) failed: {', '.join(failures)}")
    print(f"all {len(PAGES)} pages rendered without errors")


if __name__ == "__main__":
    main()
