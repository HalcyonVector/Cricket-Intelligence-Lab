/* Offline support for the dashboard.
 * Network first, cache as fallback: every visit gets the latest code and data (serve.py
 * answers unchanged files with a tiny 304, so this stays fast). Each successful response
 * is saved, so anything you've opened before still works offline.
 * If the network is slow (e.g. the free host waking from sleep) and a cached copy exists,
 * the cached copy is shown after TIMEOUT_MS; the fetch keeps going and updates the cache.
 * /api/* (live scores, photos) is never cached.
 * Bump VERSION to drop old caches after a breaking change. */
const VERSION = "cil-v2";
const TIMEOUT_MS = 4000;
const SHELL = ["./", "./index.html", "./index.js", "./playerimg.js", "./playermeta.js",
               "./rankings.js", "./icon.svg", "./manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // live data: network only
  e.respondWith(networkFirst(e));
});

async function networkFirst(e) {
  const cache = await caches.open(VERSION);
  const net = fetch(e.request).then((res) => {
    if (res.ok) cache.put(e.request, res.clone());
    return res;
  });
  e.waitUntil(net.catch(() => {})); // let the cache update finish even if we answer from cache
  const hit = await cache.match(e.request, { ignoreSearch: true });
  if (!hit) return net; // nothing cached: the network is the only option
  const timeout = new Promise((resolve) => setTimeout(() => resolve(hit), TIMEOUT_MS));
  // a server error (or the host's error page) shouldn't replace a good cached copy
  return Promise.race([net.then((r) => (r.ok ? r : hit), () => hit), timeout]);
}
