"""Vercel serverless entry point: serve.py's live-scores API (/api/*) as one Python function.

vercel.json rewrites /api/<endpoint>?<query> to /api/index?__p=<endpoint>&<query>; the
handler restores the original path, then serve.py's request handler does the rest.
The static site is hosted on GitHub Pages, which calls this API (CORS is open).
"""
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("CIL_CACHE_DIR", "/tmp/cil-cache")

from serve import H  # noqa: E402


class handler(H):
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.rstrip("/") == "/api/index":
            qs = urllib.parse.parse_qsl(u.query, keep_blank_values=True)
            ep = next((v for k, v in qs if k == "__p"), "")
            rest = urllib.parse.urlencode([(k, v) for k, v in qs if k != "__p"])
            self.path = "/api/" + ep.strip("/") + ("?" + rest if rest else "")
        if not self.path.startswith("/api/"):
            return self._send(404, {"error": "not found", "hint": "this host only serves /api/*"})
        return super().do_GET()
